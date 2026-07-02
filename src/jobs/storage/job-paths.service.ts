import {
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { JOB_STORAGE_ROOT } from '../job.tokens';

@Injectable()
export class JobPathsService {
  private readonly appRoot: string;

  constructor(
    @Optional() @Inject(JOB_STORAGE_ROOT) storageRoot?: string,
  ) {
    this.appRoot = storageRoot || path.resolve(process.cwd(), 'storage');
    mkdirSync(this.appRoot, { recursive: true });
  }

  get storageRoot(): string {
    return this.appRoot;
  }

  jobDir(jobId: string): string {
    return path.join(this.appRoot, jobId);
  }

  workspaceDir(jobId: string): string {
    return path.join(this.jobDir(jobId), 'workspace');
  }

  artifactsDir(jobId: string): string {
    return path.join(this.jobDir(jobId), 'artifacts');
  }

  statusPath(jobId: string): string {
    return path.join(this.jobDir(jobId), 'status.json');
  }

  ensureJobDirs(jobId: string) {
    mkdirSync(this.jobDir(jobId), { recursive: true });
    mkdirSync(this.workspaceDir(jobId), { recursive: true });
    mkdirSync(this.artifactsDir(jobId), { recursive: true });

    // Mounted directories need to be writable by the container's runner user.
    chmodSync(this.jobDir(jobId), 0o777);
    chmodSync(this.workspaceDir(jobId), 0o777);
    chmodSync(this.artifactsDir(jobId), 0o777);
  }

  walkFiles(dir: string): string[] {
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
}
