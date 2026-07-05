import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { BearerAuthGuard } from './shared/bearer-auth.guard';
import { JobsService } from './jobs.service';

@ApiTags('logs')
@ApiBearerAuth('bearer')
@UseGuards(BearerAuthGuard)
@Controller('logs')
export class LogsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get('recent')
  @ApiOkResponse({
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          jobId: { type: 'string' },
          text: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
        },
        required: ['jobId', 'text', 'created_at'],
      },
    },
  })
  recentLogs() {
    return this.jobsService.getRecentLogs(50);
  }
}
