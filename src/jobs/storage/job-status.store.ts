import { Injectable, NotFoundException } from '@nestjs/common';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { JobPathsService } from './job-paths.service';
import type { JobStatus, JobSummary } from '../job.types';

@Injectable()
export class JobStatusStore {
  constructor(private readonly paths: JobPathsService) {}

  writeStatus(jobId: string, status: JobStatus) {
    writeFileSync(
      this.paths.statusPath(jobId),
      JSON.stringify(status, null, 2),
      'utf8',
    );
  }

  readStatus(jobId: string): JobStatus {
    const file = this.paths.statusPath(jobId);

    if (!existsSync(file)) {
      throw new NotFoundException('Job not found');
    }

    return JSON.parse(readFileSync(file, 'utf8')) as JobStatus;
  }

  listJobs(): JobSummary[] {
    const jobs: JobSummary[] = [];

    if (!existsSync(this.paths.storageRoot)) {
      return jobs;
    }

    for (const entry of readdirSync(this.paths.storageRoot)) {
      const jobDir = path.join(this.paths.storageRoot, entry);

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
          ...(status.job ? { job: status.job } : {}),
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

  listQueuedJobs(): JobSummary[] {
    return this.listJobs().filter((job) => job.status === 'queued');
  }
}
