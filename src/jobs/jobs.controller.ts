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
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
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
import { CreateJobDto } from './dto/create-job.dto';
import { JobsService } from './jobs.service';
import { PublicRoute } from './public-route.decorator';

@ApiTags('jobs')
@ApiBearerAuth('bearer')
@UseGuards(BearerAuthGuard)
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @ApiConsumes('application/json', 'multipart/form-data')
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
          description:
            'Shell commands. For multipart requests, send repeated commands fields or a JSON string array.',
        },
        timeout_seconds: { type: 'integer', default: 300, maximum: 900 },
        network: { type: 'string', enum: ['on', 'off'], default: 'on' },
        root: { type: 'boolean', default: false },
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
          maxItems: 10,
        },
      },
      required: ['commands'],
    },
  })
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      limits: {
        fileSize: 50 * 1024 * 1024,
      },
    }),
  )
  createJob(
    @Body() dto: CreateJobDto,
    @UploadedFiles() files: Express.Multer.File[] = [],
    @Req() request: Request,
  ) {
    return this.jobsService.createJob(dto, files, this.requestOrigin(request));
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
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 50 * 1024 * 1024,
      },
    }),
  )
  uploadFile(
    @Param('jobId') jobId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.jobsService.uploadFile(jobId, file);
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
