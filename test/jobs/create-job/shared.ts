import { NotFoundException } from '@nestjs/common';
import { JobsService } from '../../../src/jobs/jobs.service';
import { JobLogsStore } from '../../../src/jobs/shared/job-logs.store';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import type { JobStatus } from '../../../src/jobs/shared/job.types';

export const TEST_DOCKER_IMAGE = 'gpt-runner:test-image';

export const noopScheduler = (() => {
  return ((callback: (...args: any[]) => void) => {
    void callback;
    return {} as NodeJS.Immediate;
  }) as typeof setImmediate;
})();

export function createJobSpec(overrides: Partial<{ goal: string; repo_url?: string }> = {}) {
  return {
    goal: 'Run the repository test suite.',
    repo_url: 'https://github.com/pallets/flask.git',
    ...overrides,
  };
}

export function cloneJob(job: JobStatus): JobStatus {
  return { ...job };
}

export function createJobStoreMock(initialJobs: JobStatus[] = []) {
  const entries = new Map(initialJobs.map((job) => [job.job_id, cloneJob(job)]));

  return {
    entries,
    writeJob: async (jobId: string, status: JobStatus) => {
      entries.set(jobId, cloneJob(status));
    },
    readJob: async (jobId: string) => {
      const job = entries.get(jobId);

      if (!job) {
        throw new NotFoundException('Job not found');
      }

      return cloneJob(job);
    },
    deleteJob: async (jobId: string) => {
      entries.delete(jobId);
    },
    listJobs: async () =>
      [...entries.values()].map(cloneJob).sort((left, right) => {
        const rightTime = Date.parse(right.updated_at) || Date.parse(right.created_at);
        const leftTime = Date.parse(left.updated_at) || Date.parse(left.created_at);
        return rightTime - leftTime;
      }),
    listQueuedJobs: async () =>
      [...entries.values()]
        .filter((job) => job.status === 'queued')
        .map(cloneJob)
        .sort((left, right) => {
          const rightTime = Date.parse(right.updated_at) || Date.parse(right.created_at);
          const leftTime = Date.parse(left.updated_at) || Date.parse(left.created_at);
          return rightTime - leftTime;
        }),
    onModuleInit: async () => undefined,
    onModuleDestroy: async () => undefined,
  } as const;
}

export function createLogsStoreMock() {
  return {
    append: async () => undefined,
    tail: async () => '',
    deleteByJobId: async () => undefined,
    recent: async () => [],
    onModuleInit: async () => undefined,
    onModuleDestroy: async () => undefined,
  } as unknown as JobLogsStore;
}

export function createJobsService(
  logsStore: JobLogsStore,
  storageRoot?: string,
  scheduler: typeof setImmediate = noopScheduler,
  fileFetchOrJobStore?: typeof fetch | ReturnType<typeof createJobStoreMock>,
  jobRunner?: {
    runBootstrap(jobId: string, dto: any): Promise<void>;
    runCommands(jobId: string, dto: any): Promise<void>;
    forceRemoveContainer(jobId: string): void;
  },
  jobStore = createJobStoreMock(),
) {
  const fileFetch = typeof fileFetchOrJobStore === 'function' ? fileFetchOrJobStore : undefined;
  const store = typeof fileFetchOrJobStore === 'function' ? jobStore : (fileFetchOrJobStore ?? jobStore);

  return new JobsService(
    logsStore,
    storageRoot,
    scheduler,
    fileFetch,
    undefined,
    undefined,
    undefined,
    jobRunner as never,
    undefined,
    undefined,
    store as never,
  );
}

export function createTempStorageRoot(prefix: string) {
  const tempRoot = mkdtempSync(path.join(tmpdir(), prefix));
  return {
    tempRoot,
    storageRoot: path.join(tempRoot, 'storage'),
  };
}
