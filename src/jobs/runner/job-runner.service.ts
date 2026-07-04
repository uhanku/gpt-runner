import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { JobLogsStore } from '../shared/job-logs.store';
import { JobPathsService } from '../storage/job-paths.service';
import { JobStore } from '../storage/job-store';
import { JobScriptBuilder } from './job-script.builder';
import { StartJobDto } from '../dto/create-job.dto';

@Injectable()
export class JobRunnerService {
  constructor(
    private readonly paths: JobPathsService,
    private readonly statuses: JobStore,
    private readonly logs: JobLogsStore,
    private readonly scriptBuilder: JobScriptBuilder,
  ) {}

  async runJob(jobId: string, dto: StartJobDto) {
    const timeoutSeconds = dto.timeout_seconds ?? 300;
    const network = dto.network ?? 'on';
    const root = dto.root ?? false;

    const status = await this.statuses.readJob(jobId);
    status.status = 'running';
    status.updated_at = this.nowIso();
    await this.statuses.writeJob(jobId, status);

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

    args.push(status.docker_image_name);
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

      void this.statuses
        .readJob(jobId)
        .then((current) => {
          current.status = 'failed';
          current.return_code = 999;
          current.updated_at = this.nowIso();
          return this.statuses.writeJob(jobId, current);
        })
        .catch((persistError) => {
          process.stderr.write(
            `[gpt-runner] failed to persist job error state for ${jobId}: ${String(persistError)}\n`,
          );
        });
    });

    child.on('close', (code) => {
      clearTimeout(timer);

      void this.statuses
        .readJob(jobId)
        .then((current) => {
          current.return_code = code;

          if (timedOut) {
            current.status = 'timeout';
          } else if (code === 0) {
            current.status = 'success';
          } else {
            current.status = 'failed';
          }

          current.updated_at = this.nowIso();
          return this.statuses.writeJob(jobId, current);
        })
        .catch((persistError) => {
          process.stderr.write(
            `[gpt-runner] failed to persist job close state for ${jobId}: ${String(persistError)}\n`,
          );
        });
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
