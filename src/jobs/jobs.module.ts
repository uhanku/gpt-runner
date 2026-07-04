import { Module } from '@nestjs/common';
import { ArtifactSignerService } from './artifacts/artifact-signer.service';
import { JobArtifactsService } from './artifacts/job-artifacts.service';
import { BearerAuthGuard } from './shared/bearer-auth.guard';
import { JobLogsStore } from './shared/job-logs.store';
import { JobsController } from './jobs.controller';
import { JobFilesService } from './files/job-files.service';
import { JobPathsService } from './storage/job-paths.service';
import { JobStore } from './storage/job-store';
import { LogsController } from './logs.controller';
import { JobsService } from './jobs.service';
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
