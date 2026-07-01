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
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type {} from 'multer';
import { BearerAuthGuard } from './bearer-auth.guard';
import {
  CreateJobDto,
  StartJobDto,
  UploadJobFilesDto,
} from './dto/create-job.dto';
import { JobsService } from './jobs.service';
import { PublicRoute } from './public-route.decorator';
import { UploadRequestBodyLoggerInterceptor } from './upload-request-body-logger.interceptor';

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
      properties: {
        job: {
          type: 'object',
          properties: {
            goal: {
              type: 'string',
              description: 'The goal of the job.',
            },
            repo_url: {
              type: 'string',
              description: 'The repository URL for the job.',
            },
          },
          required: ['goal', 'repo_url'],
        },
      },
      required: ['job'],
    },
  })
  async createJob(
    @Body() dto: CreateJobDto,
    @Req() request: Request,
  ) {
    return this.jobsService.createJob(dto.job, this.requestOrigin(request));
  }

  @Get()
  @ApiOkResponse({
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          job: {
            type: 'object',
            nullable: true,
            properties: {
              goal: { type: 'string' },
              repo_url: { type: 'string' },
            },
          },
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

  @Get('queued')
  @ApiOkResponse({
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          job: {
            type: 'object',
            nullable: true,
            properties: {
              goal: { type: 'string' },
              repo_url: { type: 'string' },
            },
          },
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
  listQueuedJobs() {
    return this.jobsService.listQueuedJobs();
  }

  @Get(':jobId')
  getJob(@Param('jobId') jobId: string) {
    return this.jobsService.getJob(jobId);
  }

  @Post(':jobId/files')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description:
            'Optional destination filename for the uploaded file string. Defaults to input.png.',
        },
        openaiFileIdRefs: {
          type: 'array',
          maxItems: 1,
          description:
            'The array where ChatGPT injects file reference strings including the secure, 5-minute transient download_link.',
          items: {
            type: 'string',
          },
        },
      },
      required: ['openaiFileIdRefs'],
    },
  })
  @UseInterceptors(
    AnyFilesInterceptor({
      limits: {
        fileSize: 50 * 1024 * 1024,
      },
    }),
    UploadRequestBodyLoggerInterceptor,
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
      example: {
        repo_url: 'https://github.com/Hugo-Dz/spritefusion-pixel-snapper.git',
        commands: ['ls -la'],
      },
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
