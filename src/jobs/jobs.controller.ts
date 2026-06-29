import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type {} from 'multer';
import { BearerAuthGuard } from './bearer-auth.guard';
import { CreateJobDto, StartJobDto, UploadJobFilesDto } from './dto/create-job.dto';
import { JobsService } from './jobs.service';
import { PublicRoute } from './public-route.decorator';

@ApiTags('jobs')
@ApiBearerAuth('bearer')
@UseGuards(BearerAuthGuard)
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @ApiBody({
    schema: {
      type: 'object',
      properties: {},
    },
  })
  async createJob(
    @Body() _dto: CreateJobDto,
    @Req() request: Request,
  ) {
    return this.jobsService.createJob(this.requestOrigin(request));
  }

  @Get()
  @ApiOkResponse({
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          job_id: { type: 'string' },
          status: {
            type: 'string',
            enum: ['queued', 'running', 'success', 'failed', 'timeout', 'deleted'],
          },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
          return_code: { type: 'integer', nullable: true },
        },
        required: ['job_id', 'status', 'created_at', 'updated_at', 'return_code'],
      },
    },
  })
  listJobs() {
    return this.jobsService.listJobs();
  }

  @Get(':jobId')
  getJob(@Param('jobId') jobId: string) {
    return this.jobsService.getJob(jobId);
  }

  @Post(':jobId/files')
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          oneOf: [
            {
              type: 'string',
              format: 'binary',
              description: 'Multipart file upload.',
            },
            {
              type: 'string',
              description:
                'ChatGPT Action file URL/reference to download into /workspace/input.png. Supports https://, file-service://, and sediment://.',
            },
          ],
        },
        filename: {
          type: 'string',
          description:
            'Optional source filename for the file string fallback. Defaults to input.png.',
        },
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
          maxItems: 1,
        },
        openaiFileIdRefs: {
          type: 'array',
          maxItems: 1,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              download_url: {
                type: 'string',
                format: 'uri',
                description:
                  'Supports https://, file-service://, and sediment://.',
              },
              download_link: {
                type: 'string',
                format: 'uri',
                description:
                  'Alias for download_url. Supports https://, file-service://, and sediment://.',
              },
            },
            required: ['name'],
            anyOf: [
              { required: ['download_url'] },
              { required: ['download_link'] },
            ],
          },
        },
      },
    },
  })
  @UseInterceptors(
    AnyFilesInterceptor({
      limits: {
        fileSize: 50 * 1024 * 1024,
      },
    }),
  )
  uploadFiles(
    @Param('jobId') jobId: string,
    @Body() dto: UploadJobFilesDto,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ) {
    return this.jobsService.uploadFile(jobId, dto, files);
  }

  @Post(':jobId/start')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        repo_url: { type: 'string' },
        branch: { type: 'string' },
        commands: {
          oneOf: [
            {
              type: 'array',
              items: { type: 'string' },
            },
            {
              type: 'string',
              description: 'JSON string array for multipart clients.',
            },
          ],
          description: 'Shell commands to run inside the container.',
        },
        timeout_seconds: { type: 'integer', default: 300, maximum: 900 },
        network: { type: 'string', enum: ['on', 'off'], default: 'on' },
        root: { type: 'boolean', default: false },
      },
      required: ['commands'],
    },
  })
  startJob(
    @Param('jobId') jobId: string,
    @Body() dto: StartJobDto,
    @Req() request: Request,
  ) {
    return this.jobsService.startJob(
      jobId,
      dto,
      this.requestOrigin(request),
    );
  }

  @Get(':jobId/artifacts')
  listArtifacts(@Param('jobId') jobId: string, @Req() request: Request) {
    return this.jobsService.listArtifacts(jobId, this.requestOrigin(request));
  }

  @Get(':jobId/artifact')
  @PublicRoute()
  downloadArtifact(
    @Param('jobId') jobId: string,
    @Query('path') artifactPath: string,
    @Query('signature') signature: string,
    @Res() res: Response,
  ) {
    const file = this.jobsService.getArtifactFile(
      jobId,
      artifactPath,
      signature,
    );
    return res.download(file.absolutePath, file.filename);
  }

  @Delete(':jobId')
  deleteJob(@Param('jobId') jobId: string) {
    return this.jobsService.deleteJob(jobId);
  }

  private requestOrigin(request: Request): string {
    const forwardedProto = request.get('x-forwarded-proto')?.split(',')[0].trim();
    const proto = forwardedProto || request.protocol;
    const host = request.get('host');

    return host ? `${proto}://${host}` : '';
  }
}
