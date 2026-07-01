import { Module } from '@nestjs/common';
import { ArtifactSignerService } from './artifacts/artifact-signer.service';
import { JobArtifactsService } from './artifacts/job-artifacts.service';
import { JobsController } from './jobs.controller';
import { JobFilesService } from './files/job-files.service';
import { JobLogsStore } from './job-logs.store';
import { JobPathsService } from './storage/job-paths.service';
import { JobStatusStore } from './storage/job-status.store';
import { LogsController } from './logs.controller';
import { JobsService } from './jobs.service';
import { BearerAuthGuard } from './bearer-auth.guard';
import { JobRunnerService } from './runner/job-runner.service';
import { JobScriptBuilder } from './runner/job-script.builder';
import { JobUrlService } from './job-url.service';

@Module({
  controllers: [JobsController, LogsController],
  providers: [
    JobsService,
    JobLogsStore,
    BearerAuthGuard,
    JobPathsService,
    JobStatusStore,
    JobUrlService,
    JobScriptBuilder,
    ArtifactSignerService,
    JobRunnerService,
    JobFilesService,
    JobArtifactsService,
  ],
})
export class JobsModule {}
