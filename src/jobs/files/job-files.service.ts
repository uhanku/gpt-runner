import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { JOB_FILE_FETCH, type FileFetch } from '../shared/job.tokens';
import { JobPathsService } from '../storage/job-paths.service';
import { JobStore } from '../storage/job-store';
import type { ReferencedFile } from '../shared/job.types';
import {
  type OpenAiFileIdRefDto,
  UploadJobFilesDto,
} from '../dto/create-job.dto';

const MAX_WORKSPACE_FILE_BYTES = 50 * 1024 * 1024;

@Injectable()
export class JobFilesService {
  constructor(
    private readonly statuses: JobStore,
    private readonly paths: JobPathsService,
    @Optional() @Inject(JOB_FILE_FETCH)
    private readonly fileFetch: FileFetch = fetch,
  ) {}

  async uploadFile(
    jobId: string,
    dto: UploadJobFilesDto,
    files: Express.Multer.File[] = [],
  ) {
    const status = await this.statuses.readJob(jobId);
    if (status.status === 'running') {
      throw new ConflictException('Cannot upload files while the job is running');
    }

    const refs: ReferencedFile[] = (dto.openaiFileIdRefs ?? []).map((ref) => ({
      ...this.normalizeOpenAiFileRef(ref, dto.filename ?? 'input.png'),
    }));

    if (files.length === 0 && refs.length === 0 && dto.file) {
      refs.push({
        name: dto.filename ?? 'input.png',
        download_url: dto.file,
      });
    }

    const inputCount = files.length + refs.length;
    if (inputCount === 0) {
      throw new BadRequestException('Missing file');
    }

    if (inputCount > 1) {
      throw new BadRequestException('Only one input image is allowed');
    }

    let buffer = files[0]?.buffer;
    if (!buffer) {
      const fileRef = refs[0];
      if (!fileRef) {
        throw new BadRequestException('Missing file');
      }

      buffer = await this.fetchReferencedFile(fileRef);
    }

    this.storeInputImage(jobId, buffer);

    return {
      job_id: jobId,
      filename: 'input.png',
      path_inside_container: '/workspace/input.png',
    };
  }

  private async fetchReferencedFile(fileRef: ReferencedFile) {
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

    return buffer;
  }

  private normalizeOpenAiFileRef(
    ref: string | OpenAiFileIdRefDto,
    fallbackName: string,
  ): ReferencedFile {
    if (typeof ref === 'string') {
      const downloadUrl = ref.trim();
      return {
        name: fallbackName,
        download_url: downloadUrl,
        download_link: downloadUrl,
      };
    }

    return {
      name: ref.name ?? fallbackName,
      download_url: ref.download_url ?? ref.download_link,
      download_link: ref.download_link ?? ref.download_url,
    };
  }

  private storeInputImage(jobId: string, buffer: Buffer) {
    const destination = path.join(this.paths.workspaceDir(jobId), 'input.png');
    writeFileSync(destination, buffer);
    chmodSync(destination, 0o666);
  }
}
