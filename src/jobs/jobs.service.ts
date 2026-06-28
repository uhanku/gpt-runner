import {
  BadRequestException,
  Inject,
  InternalServerErrorException,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { spawn } from 'node:child_process';
import type {} from 'multer';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { CreateJobDto } from './dto/create-job.dto';
import { JobLogsStore, RecentJobLogEntry } from './job-logs.store';

export const JOB_STORAGE_ROOT = 'JOB_STORAGE_ROOT';
export const JOB_SCHEDULE_IMMEDIATE = 'JOB_SCHEDULE_IMMEDIATE';
export const JOB_FILE_FETCH = 'JOB_FILE_FETCH';

const MAX_WORKSPACE_FILE_BYTES = 50 * 1024 * 1024;

type JobState =
  | 'queued'
  | 'running'
  | 'success'
  | 'failed'
  | 'timeout'
  | 'deleted';

interface JobStatus {
  job_id: string;
  status: JobState;
  created_at: string;
  updated_at: string;
  return_code: number | null;
  logs_tail?: string;
}

export interface JobSummary {
  job_id: string;
  status: JobState;
  created_at: string;
  updated_at: string;
  return_code: number | null;
}

type FileFetch = typeof fetch;

@Injectable()
export class JobsService {
  private readonly appRoot: string;

  private readonly runnerImage =
    process.env.RUNNER_IMAGE || 'gpt-runner:bookworm';

  private readonly maxLogTailBytes = Number(
    process.env.MAX_LOG_TAIL_BYTES || 20000,
  );

  constructor(
    private readonly jobLogsStore: JobLogsStore,
    @Optional() @Inject(JOB_STORAGE_ROOT) storageRoot?: string,
    @Optional()
    @Inject(JOB_SCHEDULE_IMMEDIATE)
    private readonly scheduleImmediate: typeof setImmediate = setImmediate,
    @Optional()
    @Inject(JOB_FILE_FETCH)
    private readonly fileFetch: FileFetch = fetch,
  ) {
    this.appRoot = storageRoot || path.resolve(process.cwd(), 'storage');
    mkdirSync(this.appRoot, { recursive: true });
  }

  async createJob(
    dto: CreateJobDto,
    files: Express.Multer.File[] = [],
    fallbackBaseUrl?: string,
  ) {
    const jobId = randomUUID();
    const baseUrl = this.publicBaseUrl(fallbackBaseUrl);

    this.ensureJobDirs(jobId);

    const status: JobStatus = {
      job_id: jobId,
      status: 'queued',
      created_at: this.nowIso(),
      updated_at: this.nowIso(),
      return_code: null,
    };

    this.writeStatus(jobId, status);

    for (const file of files) {
      this.storeWorkspaceFile(jobId, file);
    }

    await this.storeChatGptFileReferences(jobId, dto);

    this.scheduleImmediate(() => {
      this.runJob(jobId, dto);
    });

    return {
      job_id: jobId,
      status: 'queued',
      status_url: this.absoluteUrl(baseUrl, `/jobs/${jobId}`),
      artifacts_url: this.absoluteUrl(baseUrl, `/jobs/${jobId}/artifacts`),
    };
  }

  async getJob(jobId: string) {
    const status = this.readStatus(jobId);
    return {
      ...status,
      logs_tail: await this.jobLogsStore.tail(jobId, this.maxLogTailBytes),
    };
  }

  listJobs(): JobSummary[] {
    const jobs: JobSummary[] = [];

    if (!existsSync(this.appRoot)) {
      return jobs;
    }

    for (const entry of readdirSync(this.appRoot)) {
      const jobDir = path.join(this.appRoot, entry);

      if (!statSync(jobDir).isDirectory()) {
        continue;
      }

      const statusFile = path.join(jobDir, 'status.json');
      if (!existsSync(statusFile)) {
        continue;
      }

      try {
        const status = JSON.parse(readFileSync(statusFile, 'utf8')) as JobStatus;
        jobs.push({
          job_id: status.job_id,
          status: status.status,
          created_at: status.created_at,
          updated_at: status.updated_at,
          return_code: status.return_code,
        });
      } catch {
        continue;
      }
    }

    jobs.sort((a, b) => {
      const right = Date.parse(b.updated_at) || Date.parse(b.created_at);
      const left = Date.parse(a.updated_at) || Date.parse(a.created_at);
      return right - left;
    });

    return jobs;
  }

  async getRecentLogs(limit = 50): Promise<RecentJobLogEntry[]> {
    return this.jobLogsStore.recent(limit);
  }

  uploadFile(jobId: string, file: Express.Multer.File) {
    this.readStatus(jobId);

    if (!file) {
      throw new BadRequestException('Missing file');
    }

    const filename = this.storeWorkspaceFile(jobId, file);

    return {
      job_id: jobId,
      filename,
      path_inside_container: `/workspace/${filename}`,
    };
  }

  listArtifacts(jobId: string, fallbackBaseUrl?: string) {
    this.readStatus(jobId);

    const baseUrl = this.publicBaseUrl(fallbackBaseUrl);
    const base = this.artifactsDir(jobId);
    const files = this.walkFiles(base).map((absolutePath) => {
      const rel = path.relative(base, absolutePath).replaceAll(path.sep, '/');
      const signature = this.signArtifactPath(jobId, rel);
      const params = new URLSearchParams({
        path: rel,
        signature,
      });
      const downloadPath = `/jobs/${jobId}/artifact?${params.toString()}`;

      return {
        name: rel,
        size_bytes: statSync(absolutePath).size,
        download_url: this.absoluteUrl(baseUrl, downloadPath),
      };
    });

    return {
      job_id: jobId,
      artifacts: files,
    };
  }

  getArtifactFile(jobId: string, artifactPath: string, signature: string) {
    this.readStatus(jobId);

    if (!artifactPath) {
      throw new BadRequestException('Missing artifact path');
    }

    this.verifyArtifactSignature(jobId, artifactPath, signature);

    const base = path.resolve(this.artifactsDir(jobId));
    const target = path.resolve(base, artifactPath);

    if (target !== base && !target.startsWith(base + path.sep)) {
      throw new BadRequestException('Invalid artifact path');
    }

    if (!existsSync(target) || !statSync(target).isFile()) {
      throw new NotFoundException('Artifact not found');
    }

    return {
      absolutePath: target,
      filename: path.basename(target),
    };
  }

  async deleteJob(jobId: string) {
    const dir = this.jobDir(jobId);

    if (!existsSync(dir)) {
      throw new NotFoundException('Job not found');
    }

    this.forceRemoveContainer(jobId);
    await this.jobLogsStore.deleteByJobId(jobId);
    rmSync(dir, { recursive: true, force: true });

    return {
      job_id: jobId,
      status: 'deleted',
    };
  }

  private runJob(jobId: string, dto: CreateJobDto) {
    const timeoutSeconds = dto.timeout_seconds ?? 300;
    const network = dto.network ?? 'on';
    const root = dto.root ?? false;

    const status = this.readStatus(jobId);
    status.status = 'running';
    status.updated_at = this.nowIso();
    this.writeStatus(jobId, status);

    const scriptFile = path.join(this.jobDir(jobId), 'run.sh');
    writeFileSync(scriptFile, this.safeScript(dto), 'utf8');
    chmodSync(scriptFile, 0o644);

    const containerName = `gpt-job-${jobId}`;

    const args = [
      'run',
      '--rm',
      '--name',
      containerName,

      '--memory',
      '4g',

      '--cpus',
      '2',

      '--pids-limit',
      '512',

      '--security-opt',
      'no-new-privileges',

      '--network',
      network === 'on' ? 'bridge' : 'none',

      '-v',
      `${this.workspaceDir(jobId)}:/workspace:rw`,

      '-v',
      `${this.artifactsDir(jobId)}:/artifacts:rw`,

      '-v',
      `${scriptFile}:/tmp/run.sh:ro`,
    ];

    if (!root) {
      args.push('--user', 'runner');
      args.push('--cap-drop', 'ALL');
    }

    args.push(this.runnerImage);
    args.push('bash', '/tmp/run.sh');

    this.appendLog(jobId, `$ docker ${args.join(' ')}\n\n`);

    const child = spawn('docker', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      this.appendLog(
        jobId,
        '\n[gpt-runner] timeout reached; killing container\n',
      );
      this.forceRemoveContainer(jobId);
      child.kill('SIGKILL');
    }, timeoutSeconds * 1000);

    child.stdout.on('data', (chunk: Buffer) => {
      this.appendLog(jobId, chunk.toString('utf8'));
    });

    child.stderr.on('data', (chunk: Buffer) => {
      this.appendLog(jobId, chunk.toString('utf8'));
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      this.appendLog(jobId, `\n[gpt-runner] controller error: ${error}\n`);

      const current = this.readStatus(jobId);
      current.status = 'failed';
      current.return_code = 999;
      current.updated_at = this.nowIso();
      this.writeStatus(jobId, current);
    });

    child.on('close', (code) => {
      clearTimeout(timer);

      const current = this.readStatus(jobId);
      current.return_code = code;

      if (timedOut) {
        current.status = 'timeout';
      } else if (code === 0) {
        current.status = 'success';
      } else {
        current.status = 'failed';
      }

      current.updated_at = this.nowIso();
      this.writeStatus(jobId, current);
    });
  }

  private safeScript(dto: CreateJobDto): string {
    const lines = [
      'set -euo pipefail',
      'cd /workspace',
      "echo '[gpt-runner] started at:' $(date -Iseconds)",
      "echo '[gpt-runner] user:' $(id)",
    ];

    if (dto.repo_url) {
      let cloneCommand = 'git clone';

      if (dto.branch) {
        cloneCommand += ` --branch ${this.shQuote(dto.branch)}`;
      }

      cloneCommand += ` ${this.shQuote(dto.repo_url)} repo`;
      lines.push(cloneCommand);
      lines.push('cd repo');
    }

    lines.push("echo '[gpt-runner] running commands'");
    let addedPytestBootstrap = false;
    for (const command of dto.commands) {
      if (!addedPytestBootstrap && this.needsPytestBootstrap(command)) {
        lines.push(this.pytestBootstrapScript());
        addedPytestBootstrap = true;
      }

      lines.push(command);
    }
    lines.push("echo '[gpt-runner] finished at:' $(date -Iseconds)");

    return lines.join('\n') + '\n';
  }

  private needsPytestBootstrap(command: string): boolean {
    return /(?:^|[\s;&|()])pytest(?:\s|$)/.test(command);
  }

  private pytestBootstrapScript(): string {
    return [
      'if [ -f .venv/bin/activate ]; then',
      '  . .venv/bin/activate',
      "  python -m pip install 'pytest<9'",
      '  if [ -f pyproject.toml ]; then',
      "    python - <<'PY'",
      'import pathlib',
      'import tomllib',
      '',
      'pyproject = pathlib.Path("pyproject.toml")',
      'requirements = pathlib.Path("/tmp/gpt-runner-test-requirements.txt")',
      'data = tomllib.loads(pyproject.read_text("utf8"))',
      'deps = data.get("dependency-groups", {}).get("tests", [])',
      'requirements.write_text(',
      '    "\\n".join(dep for dep in deps if isinstance(dep, str)),',
      '    "utf8",',
      ')',
      'PY',
      '    if [ -s /tmp/gpt-runner-test-requirements.txt ]; then',
      '      python -m pip install -r /tmp/gpt-runner-test-requirements.txt',
      '    fi',
      '  fi',
      'fi',
    ].join('\n');
  }

  private shQuote(value: string): string {
    return `'${value.replaceAll("'", `'"'"'`)}'`;
  }

  private forceRemoveContainer(jobId: string) {
    const containerName = `gpt-job-${jobId}`;

    spawn('docker', ['rm', '-f', containerName], {
      stdio: 'ignore',
      detached: true,
    }).unref();
  }

  private storeWorkspaceFile(jobId: string, file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Missing file');
    }

    return this.storeWorkspaceBuffer(
      jobId,
      file.originalname || 'upload.bin',
      file.buffer,
    );
  }

  private async storeChatGptFileReferences(jobId: string, dto: CreateJobDto) {
    for (const fileRef of dto.openaiFileIdRefs ?? []) {
      const downloadUrl = fileRef.download_url ?? fileRef.download_link;
      if (!downloadUrl) {
        throw new BadRequestException(
          `Missing download URL for referenced file: ${fileRef.name}`,
        );
      }

      const response = await this.fileFetch(downloadUrl);

      if (!response.ok) {
        throw new BadRequestException(
          `Failed to download referenced file: ${fileRef.name}`,
        );
      }

      const contentLength = response.headers.get('content-length');
      if (
        contentLength &&
        Number.isFinite(Number(contentLength)) &&
        Number(contentLength) > MAX_WORKSPACE_FILE_BYTES
      ) {
        throw new BadRequestException(
          `Referenced file is too large: ${fileRef.name}`,
        );
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > MAX_WORKSPACE_FILE_BYTES) {
        throw new BadRequestException(
          `Referenced file is too large: ${fileRef.name}`,
        );
      }

      this.storeWorkspaceBuffer(jobId, fileRef.name, buffer);
    }
  }

  private storeWorkspaceBuffer(jobId: string, originalName: string, buffer: Buffer) {
    const filename = path.basename(originalName || 'upload.bin');
    if (!filename || filename === '.' || filename === '..') {
      throw new BadRequestException('Invalid file name');
    }

    const destination = path.join(this.workspaceDir(jobId), filename);

    writeFileSync(destination, buffer);
    chmodSync(destination, 0o666);

    return filename;
  }

  private ensureJobDirs(jobId: string) {
    mkdirSync(this.jobDir(jobId), { recursive: true });
    mkdirSync(this.workspaceDir(jobId), { recursive: true });
    mkdirSync(this.artifactsDir(jobId), { recursive: true });

    // Mounted directories need to be writable by the container's runner user.
    chmodSync(this.jobDir(jobId), 0o777);
    chmodSync(this.workspaceDir(jobId), 0o777);
    chmodSync(this.artifactsDir(jobId), 0o777);
  }

  private walkFiles(dir: string): string[] {
    if (!existsSync(dir)) {
      return [];
    }

    const results: string[] = [];

    for (const entry of readdirSync(dir)) {
      const absolute = path.join(dir, entry);
      const stat = statSync(absolute);

      if (stat.isDirectory()) {
        results.push(...this.walkFiles(absolute));
      } else if (stat.isFile()) {
        results.push(absolute);
      }
    }

    return results;
  }

  private writeStatus(jobId: string, status: JobStatus) {
    writeFileSync(
      this.statusPath(jobId),
      JSON.stringify(status, null, 2),
      'utf8',
    );
  }

  private readStatus(jobId: string): JobStatus {
    const file = this.statusPath(jobId);

    if (!existsSync(file)) {
      throw new NotFoundException('Job not found');
    }

    return JSON.parse(readFileSync(file, 'utf8')) as JobStatus;
  }

  private appendLog(jobId: string, text: string) {
    void this.jobLogsStore.append(jobId, text).catch((error) => {
      process.stderr.write(
        `[gpt-runner] failed to persist log chunk for ${jobId}: ${String(error)}\n`,
      );
    });
  }

  private nowIso(): string {
    return new Date().toISOString();
  }

  private publicBaseUrl(fallbackBaseUrl?: string): string {
    return (process.env.PUBLIC_BASE_URL || fallbackBaseUrl || '').replace(
      /\/+$/,
      '',
    );
  }

  private absoluteUrl(baseUrl: string, pathAndQuery: string): string {
    return baseUrl ? `${baseUrl}${pathAndQuery}` : pathAndQuery;
  }

  private signArtifactPath(jobId: string, artifactPath: string): string {
    const secret = this.publicArtifactSecret();

    return createHmac('sha256', secret)
      .update(this.artifactSignaturePayload(jobId, artifactPath), 'utf8')
      .digest('hex');
  }

  private verifyArtifactSignature(
    jobId: string,
    artifactPath: string,
    signature: string,
  ) {
    if (!signature) {
      throw new UnauthorizedException('Missing artifact signature');
    }

    if (!/^[0-9a-f]{64}$/i.test(signature)) {
      throw new UnauthorizedException('Invalid artifact signature');
    }

    const expected = Buffer.from(
      this.signArtifactPath(jobId, artifactPath),
      'hex',
    );
    const actual = Buffer.from(signature, 'hex');

    if (!timingSafeEqual(expected, actual)) {
      throw new UnauthorizedException('Invalid artifact signature');
    }
  }

  private artifactSignaturePayload(jobId: string, artifactPath: string): string {
    return `${jobId}\n${artifactPath}`;
  }

  private publicArtifactSecret(): string {
    const secret = process.env.PUBLIC_ARTIFACT_SECRET;

    if (!secret) {
      throw new InternalServerErrorException(
        'Server misconfigured: PUBLIC_ARTIFACT_SECRET is not set.',
      );
    }

    return secret;
  }

  private jobDir(jobId: string): string {
    return path.join(this.appRoot, jobId);
  }

  private workspaceDir(jobId: string): string {
    return path.join(this.jobDir(jobId), 'workspace');
  }

  private artifactsDir(jobId: string): string {
    return path.join(this.jobDir(jobId), 'artifacts');
  }

  private statusPath(jobId: string): string {
    return path.join(this.jobDir(jobId), 'status.json');
  }
}
