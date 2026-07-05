import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { BearerAuthGuard } from './shared/bearer-auth.guard';
import { AvailableJobsStore } from './storage/available-jobs.store';

@ApiTags('available-jobs')
@ApiBearerAuth('bearer')
@UseGuards(BearerAuthGuard)
@Controller('available-jobs')
export class AvailableJobsController {
  constructor(private readonly availableJobsStore: AvailableJobsStore) {}

  @Get()
  @ApiOkResponse({
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          goal: { type: 'string' },
        },
        required: ['id', 'name', 'goal'],
      },
    },
  })
  listAvailableJobs() {
    return this.availableJobsStore.listJobs();
  }

  @Get(':id')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        goal: { type: 'string' },
      },
      required: ['id', 'name', 'goal'],
    },
  })
  getAvailableJob(@Param('id') id: string) {
    return this.availableJobsStore.getJob(id);
  }
}
