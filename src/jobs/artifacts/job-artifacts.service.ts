import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { JobUrlService } from '../job-url.service';
import { JobPathsService } from '../storage/job-paths.service';
import { JobStatusStore } from '../storage/job-status.store';
import { ArtifactSignerService } from './artifact-signer.service';

@Injectable()
export class JobArtifactsService {
  constructor(
    private readonly statuses: JobStatusStore,
    private readonly paths: JobPathsService,
    private readonly signer: ArtifactSignerService,
    private readonly urls: JobUrlService,
  ) {}

  listArtifacts(jobId: string, fallbackBaseUrl?: string) {
    this.statuses.readStatus(jobId);

    const baseUrl = this.urls.publicBaseUrl(fallbackBaseUrl);
    const base = this.paths.artifactsDir(jobId);
    const files = this.paths.walkFiles(base).map((absolutePath) => {
      const rel = path.relative(base, absolutePath).replaceAll(path.sep, '/');
      const signature = this.signer.signArtifactPath(jobId, rel);
      const params = new URLSearchParams({
        path: rel,
        signature,
      });
      const downloadPath = `/jobs/${jobId}/artifact?${params.toString()}`;

      return {
        name: rel,
        size_bytes: statSync(absolutePath).size,
        download_url: this.urls.absoluteUrl(baseUrl, downloadPath),
      };
    });

    return {
      job_id: jobId,
      artifacts: files,
    };
  }

  getArtifactFile(jobId: string, artifactPath: string, signature: string) {
    this.statuses.readStatus(jobId);

    if (!artifactPath) {
      throw new BadRequestException('Missing artifact path');
    }

    this.signer.verifyArtifactSignature(jobId, artifactPath, signature);

    const base = path.resolve(this.paths.artifactsDir(jobId));
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
}
