import { Module } from '@nestjs/common';
import { ArtifactSignerService } from './artifacts/artifact-signer.service';
import { JobArtifactsService } from './artifacts/job-artifacts.service';
import { BearerAuthGuard } from './shared/bearer-auth.guard';
import { JobLogsStore } from './shared/job-logs.store';
import { JobsController } from './jobs.controller';
import { JobFilesService } from './files/job-files.service';
import { JobPathsService } from './storage/job-paths.service';
import { JobStore } from './storage/job-store';
import { AvailableJobsStore } from './storage/available-jobs.store';
import { LogsController } from './logs.controller';
import { JobsService } from './jobs.service';
import { JobRunnerService } from './runner/job-runner.service';
import { JobScriptBuilder } from './runner/job-script.builder';
import { JobUrlService } from './job-url.service';
import { AvailableJobsController } from './available-jobs.controller';

@Module({
  controllers: [JobsController, LogsController, AvailableJobsController],
  providers: [
    JobsService,
    JobLogsStore,
    BearerAuthGuard,
    AvailableJobsStore,
    JobPathsService,
    JobStore,
    JobUrlService,
    JobScriptBuilder,
    ArtifactSignerService,
    JobRunnerService,
    JobFilesService,
    JobArtifactsService,
  ],
})
export class JobsModule {}
