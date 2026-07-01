import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { JobLogsStore } from '../job-logs.store';
import { JobPathsService } from '../storage/job-paths.service';
import { JobStatusStore } from '../storage/job-status.store';
import { JobScriptBuilder } from './job-script.builder';
import { StartJobDto } from '../dto/create-job.dto';

@Injectable()
export class JobRunnerService {
  private readonly runnerImage =
    process.env.RUNNER_IMAGE || 'gpt-runner:bookworm';

  constructor(
    private readonly paths: JobPathsService,
    private readonly statuses: JobStatusStore,
    private readonly logs: JobLogsStore,
    private readonly scriptBuilder: JobScriptBuilder,
  ) {}

  runJob(jobId: string, dto: StartJobDto) {
    const timeoutSeconds = dto.timeout_seconds ?? 300;
    const network = dto.network ?? 'on';
    const root = dto.root ?? false;

    const status = this.statuses.readStatus(jobId);
    status.status = 'running';
    status.updated_at = this.nowIso();
    this.statuses.writeStatus(jobId, status);

    const scriptFile = path.join(this.paths.jobDir(jobId), 'run.sh');
    writeFileSync(scriptFile, this.scriptBuilder.safeScript(dto), 'utf8');
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
      `${this.paths.workspaceDir(jobId)}:/workspace:rw`,
      '-v',
      `${this.paths.artifactsDir(jobId)}:/artifacts:rw`,
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

      const current = this.statuses.readStatus(jobId);
      current.status = 'failed';
      current.return_code = 999;
      current.updated_at = this.nowIso();
      this.statuses.writeStatus(jobId, current);
    });

    child.on('close', (code) => {
      clearTimeout(timer);

      const current = this.statuses.readStatus(jobId);
      current.return_code = code;

      if (timedOut) {
        current.status = 'timeout';
      } else if (code === 0) {
        current.status = 'success';
      } else {
        current.status = 'failed';
      }

      current.updated_at = this.nowIso();
      this.statuses.writeStatus(jobId, current);
    });
  }

  forceRemoveContainer(jobId: string) {
    const containerName = `gpt-job-${jobId}`;

    spawn('docker', ['rm', '-f', containerName], {
      stdio: 'ignore',
      detached: true,
    }).unref();
  }

  appendLog(jobId: string, text: string) {
    void this.logs.append(jobId, text).catch((error) => {
      process.stderr.write(
        `[gpt-runner] failed to persist log chunk for ${jobId}: ${String(error)}\n`,
      );
    });
  }

  private nowIso(): string {
    return new Date().toISOString();
  }
}
