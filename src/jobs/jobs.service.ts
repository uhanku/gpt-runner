import { ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { RunJobCommandsDto, StartJobDto, UploadJobFilesDto } from './dto/create-job.dto';
import { JobLogsStore, RecentJobLogEntry } from './shared/job-logs.store';
import { JOB_FILE_FETCH, JOB_SCHEDULE_IMMEDIATE, JOB_STORAGE_ROOT, type FileFetch } from './shared/job.tokens';
import type { JobSpec, JobState, JobStatus, JobSummary } from './shared/job.types';
import { JobArtifactsService } from './artifacts/job-artifacts.service';
import { ArtifactSignerService } from './artifacts/artifact-signer.service';
import { JobFilesService } from './files/job-files.service';
import { JobPathsService } from './storage/job-paths.service';
import { JobStore } from './storage/job-store';
import { JobRunnerService } from './runner/job-runner.service';
import { JobScriptBuilder } from './runner/job-script.builder';
import { JobUrlService } from './job-url.service';

@Injectable()
export class JobsService {
  private readonly maxLogTailBytes = Number(process.env.MAX_LOG_TAIL_BYTES || 20000);

  private readonly paths: JobPathsService;
  private readonly statuses: JobStore;
  private readonly urls: JobUrlService;
  private readonly scriptBuilder: JobScriptBuilder;
  private readonly runner: JobRunnerService;
  private readonly files: JobFilesService;
  private readonly artifacts: JobArtifactsService;

  constructor(
    private readonly jobLogsStore: JobLogsStore,
    @Optional() @Inject(JOB_STORAGE_ROOT) storageRoot?: string,
    @Optional()
    @Inject(JOB_SCHEDULE_IMMEDIATE)
    private readonly scheduleImmediate: typeof setImmediate = setImmediate,
    @Optional()
    @Inject(JOB_FILE_FETCH)
    private readonly fileFetch: FileFetch = fetch,
    @Optional() private readonly jobPaths?: JobPathsService,
    @Optional() private readonly jobUrlService?: JobUrlService,
    @Optional() private readonly jobScriptBuilder?: JobScriptBuilder,
    @Optional() private readonly jobRunner?: JobRunnerService,
    @Optional() private readonly jobFiles?: JobFilesService,
    @Optional() private readonly jobArtifacts?: JobArtifactsService,
    @Optional() private readonly jobStore?: JobStore,
  ) {
    this.paths = jobPaths ?? new JobPathsService(storageRoot);
    this.statuses = jobStore ?? new JobStore();
    this.urls = jobUrlService ?? new JobUrlService();

    this.scriptBuilder = jobScriptBuilder ?? new JobScriptBuilder();
    const runner = jobRunner ?? new JobRunnerService(this.paths, this.statuses, this.jobLogsStore, this.scriptBuilder);
    const files = jobFiles ?? new JobFilesService(this.statuses, this.paths, fileFetch);
    const artifacts =
      jobArtifacts ?? new JobArtifactsService(this.statuses, this.paths, new ArtifactSignerService(), this.urls);

    this.runner = runner;
    this.files = files;
    this.artifacts = artifacts;
  }

  async createJob(job: JobSpec, dockerImageName: string, fallbackBaseUrl?: string) {
    const jobId = randomUUID();
    const baseUrl = this.urls.publicBaseUrl(fallbackBaseUrl);

    this.paths.ensureJobDirs(jobId);

    const status: JobStatus = {
      job_id: jobId,
      status: 'queued',
      created_at: this.nowIso(),
      updated_at: this.nowIso(),
      return_code: null,
      goal: job.goal,
      ...(job.repo_url !== undefined ? { repo_url: job.repo_url } : {}),
      docker_image_name: dockerImageName,
    };

    await this.statuses.writeJob(jobId, status);

    return this.jobEnvelope(jobId, 'queued', baseUrl, job);
  }

  async getJob(jobId: string) {
    const status = await this.statuses.readJob(jobId);
    return {
      ...status,
      logs_tail: await this.jobLogsStore.tail(jobId, this.maxLogTailBytes),
    };
  }

  async listJobs(): Promise<JobSummary[]> {
    return this.statuses.listJobs();
  }

  async listQueuedJobs(): Promise<JobSummary[]> {
    return this.statuses.listQueuedJobs();
  }

  async getRecentLogs(limit = 50): Promise<RecentJobLogEntry[]> {
    return this.jobLogsStore.recent(limit);
  }

  async startJob(jobId: string, dto: StartJobDto, fallbackBaseUrl?: string) {
    const status = await this.statuses.readJob(jobId);
    if (status.status === 'running') {
      throw new ConflictException('Job is already running');
    }

    if (dto.repo_url) {
      status.repo_url = dto.repo_url;
    }

    status.status = 'running';
    status.return_code = null;
    status.updated_at = this.nowIso();
    await this.statuses.writeJob(jobId, status);

    this.scheduleImmediate(() => {
      const bootstrapDto = dto.repo_url || !status.repo_url ? dto : { ...dto, repo_url: status.repo_url };

      void this.runner.runBootstrap(jobId, bootstrapDto).catch((error) => {
        process.stderr.write(`[gpt-runner] failed to bootstrap job ${jobId}: ${String(error)}\n`);
      });
    });

    return this.jobEnvelope(jobId, 'running', this.urls.publicBaseUrl(fallbackBaseUrl), {
      goal: status.goal,
      ...(status.repo_url !== undefined ? { repo_url: status.repo_url } : {}),
    });
  }

  async runCommands(jobId: string, dto: RunJobCommandsDto, fallbackBaseUrl?: string) {
    const status = await this.statuses.readJob(jobId);
    if (status.status === 'running') {
      throw new ConflictException('Job is already running');
    }

    status.status = 'running';
    status.return_code = null;
    status.updated_at = this.nowIso();
    await this.statuses.writeJob(jobId, status);

    this.scheduleImmediate(() => {
      void this.runner.runCommands(jobId, dto).catch((error) => {
        process.stderr.write(`[gpt-runner] failed to run commands for job ${jobId}: ${String(error)}\n`);
      });
    });

    return this.jobEnvelope(jobId, 'running', this.urls.publicBaseUrl(fallbackBaseUrl), {
      goal: status.goal,
      ...(status.repo_url !== undefined ? { repo_url: status.repo_url } : {}),
    });
  }

  async uploadFile(jobId: string, dto: UploadJobFilesDto, files: Express.Multer.File[] = []) {
    return this.files.uploadFile(jobId, dto, files);
  }

  async listArtifacts(jobId: string, fallbackBaseUrl?: string) {
    return this.artifacts.listArtifacts(jobId, fallbackBaseUrl);
  }

  async getArtifactFile(jobId: string, artifactPath: string, signature: string) {
    return this.artifacts.getArtifactFile(jobId, artifactPath, signature);
  }

  bootstrapScript(dto: StartJobDto): string {
    return this.scriptBuilder.bootstrapScript(dto);
  }

  commandsScript(dto: RunJobCommandsDto): string {
    return this.scriptBuilder.commandsScript(dto);
  }

  safeScript(dto: RunJobCommandsDto): string {
    return this.scriptBuilder.safeScript(dto);
  }

  async deleteJob(jobId: string) {
    const dir = this.paths.jobDir(jobId);

    if (!existsSync(dir)) {
      throw new NotFoundException('Job not found');
    }

    this.runner.forceRemoveContainer(jobId);
    await this.jobLogsStore.deleteByJobId(jobId);
    await this.statuses.deleteJob(jobId);
    rmSync(dir, { recursive: true, force: true });

    return {
      job_id: jobId,
      status: 'deleted',
    };
  }

  private jobEnvelope(jobId: string, status: JobState, baseUrl: string, job?: JobSpec) {
    const envelope: {
      job_id: string;
      status: JobState;
      status_url: string;
      artifacts_url: string;
      goal?: string;
      repo_url?: string;
    } = {
      job_id: jobId,
      status,
      status_url: this.urls.absoluteUrl(baseUrl, `/jobs/${jobId}`),
      artifacts_url: this.urls.absoluteUrl(baseUrl, `/jobs/${jobId}/artifacts`),
    };

    if (job) {
      envelope.goal = job.goal;

      if (job.repo_url !== undefined) {
        envelope.repo_url = job.repo_url;
      }
    }

    return envelope;
  }

  private nowIso(): string {
    return new Date().toISOString();
  }
}

export { JOB_FILE_FETCH, JOB_SCHEDULE_IMMEDIATE, JOB_STORAGE_ROOT } from './shared/job.tokens';
export type { JobSpec, JobState, JobStatus, JobSummary, ReferencedFile } from './shared/job.types';
