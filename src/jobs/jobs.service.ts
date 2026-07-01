import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { StartJobDto, UploadJobFilesDto } from './dto/create-job.dto';
import { JobLogsStore, RecentJobLogEntry } from './job-logs.store';
import {
  JOB_FILE_FETCH,
  JOB_SCHEDULE_IMMEDIATE,
  JOB_STORAGE_ROOT,
  type FileFetch,
} from './job.tokens';
import type { JobSpec, JobState, JobStatus, JobSummary } from './job.types';
import { JobArtifactsService } from './artifacts/job-artifacts.service';
import { ArtifactSignerService } from './artifacts/artifact-signer.service';
import { JobFilesService } from './files/job-files.service';
import { JobPathsService } from './storage/job-paths.service';
import { JobStatusStore } from './storage/job-status.store';
import { JobRunnerService } from './runner/job-runner.service';
import { JobScriptBuilder } from './runner/job-script.builder';
import { JobUrlService } from './job-url.service';

@Injectable()
export class JobsService {
  private readonly maxLogTailBytes = Number(
    process.env.MAX_LOG_TAIL_BYTES || 20000,
  );

  private readonly paths: JobPathsService;
  private readonly statuses: JobStatusStore;
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
    @Optional() private readonly jobStatusStore?: JobStatusStore,
    @Optional() private readonly jobUrlService?: JobUrlService,
    @Optional() private readonly jobScriptBuilder?: JobScriptBuilder,
    @Optional() private readonly jobRunner?: JobRunnerService,
    @Optional() private readonly jobFiles?: JobFilesService,
    @Optional() private readonly jobArtifacts?: JobArtifactsService,
  ) {
    this.paths = jobPaths ?? new JobPathsService(storageRoot);
    this.statuses = jobStatusStore ?? new JobStatusStore(this.paths);
    this.urls = jobUrlService ?? new JobUrlService();

    this.scriptBuilder = jobScriptBuilder ?? new JobScriptBuilder();
    const runner =
      jobRunner ??
      new JobRunnerService(
        this.paths,
        this.statuses,
        this.jobLogsStore,
        this.scriptBuilder,
      );
    const files =
      jobFiles ?? new JobFilesService(this.statuses, this.paths, fileFetch);
    const artifacts =
      jobArtifacts ??
      new JobArtifactsService(
        this.statuses,
        this.paths,
        new ArtifactSignerService(),
        this.urls,
      );

    this.runner = runner;
    this.files = files;
    this.artifacts = artifacts;
  }

  async createJob(job?: JobSpec, fallbackBaseUrl?: string) {
    const jobId = randomUUID();
    const baseUrl = this.urls.publicBaseUrl(fallbackBaseUrl);

    this.paths.ensureJobDirs(jobId);

    const status: JobStatus = {
      job_id: jobId,
      status: 'queued',
      created_at: this.nowIso(),
      updated_at: this.nowIso(),
      return_code: null,
      job,
    };

    this.statuses.writeStatus(jobId, status);

    return this.jobEnvelope(jobId, 'queued', baseUrl, job);
  }

  async getJob(jobId: string) {
    const status = this.statuses.readStatus(jobId);
    return {
      ...status,
      logs_tail: await this.jobLogsStore.tail(jobId, this.maxLogTailBytes),
    };
  }

  listJobs(): JobSummary[] {
    return this.statuses.listJobs();
  }

  listQueuedJobs(): JobSummary[] {
    return this.statuses.listQueuedJobs();
  }

  async getRecentLogs(limit = 50): Promise<RecentJobLogEntry[]> {
    return this.jobLogsStore.recent(limit);
  }

  startJob(jobId: string, dto: StartJobDto, fallbackBaseUrl?: string) {
    const status = this.statuses.readStatus(jobId);
    if (status.status === 'running') {
      throw new ConflictException('Job is already running');
    }

    status.status = 'running';
    status.return_code = null;
    status.updated_at = this.nowIso();
    this.statuses.writeStatus(jobId, status);

    this.scheduleImmediate(() => {
      this.runner.runJob(jobId, dto);
    });

    return this.jobEnvelope(
      jobId,
      'running',
      this.urls.publicBaseUrl(fallbackBaseUrl),
      status.job,
    );
  }

  async uploadFile(
    jobId: string,
    dto: UploadJobFilesDto,
    files: Express.Multer.File[] = [],
  ) {
    return this.files.uploadFile(jobId, dto, files);
  }

  listArtifacts(jobId: string, fallbackBaseUrl?: string) {
    return this.artifacts.listArtifacts(jobId, fallbackBaseUrl);
  }

  getArtifactFile(jobId: string, artifactPath: string, signature: string) {
    return this.artifacts.getArtifactFile(jobId, artifactPath, signature);
  }

  safeScript(dto: StartJobDto): string {
    return this.scriptBuilder.safeScript(dto);
  }

  async deleteJob(jobId: string) {
    const dir = this.paths.jobDir(jobId);

    if (!existsSync(dir)) {
      throw new NotFoundException('Job not found');
    }

    this.runner.forceRemoveContainer(jobId);
    await this.jobLogsStore.deleteByJobId(jobId);
    rmSync(dir, { recursive: true, force: true });

    return {
      job_id: jobId,
      status: 'deleted',
    };
  }

  private jobEnvelope(
    jobId: string,
    status: JobState,
    baseUrl: string,
    job?: JobSpec,
  ) {
    return {
      job_id: jobId,
      status,
      ...(job ? { job } : {}),
      status_url: this.urls.absoluteUrl(baseUrl, `/jobs/${jobId}`),
      artifacts_url: this.urls.absoluteUrl(baseUrl, `/jobs/${jobId}/artifacts`),
    };
  }

  private nowIso(): string {
    return new Date().toISOString();
  }
}

export {
  JOB_FILE_FETCH,
  JOB_SCHEDULE_IMMEDIATE,
  JOB_STORAGE_ROOT,
} from './job.tokens';
export type {
  JobSpec,
  JobState,
  JobStatus,
  JobSummary,
  ReferencedFile,
} from './job.types';
