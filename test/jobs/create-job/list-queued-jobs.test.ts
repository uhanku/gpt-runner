import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { rmSync } from 'node:fs';
import {
  createJobStoreMock,
  createJobsService,
  createLogsStoreMock,
  createTempStorageRoot,
  noopScheduler,
  TEST_DOCKER_IMAGE,
} from './shared';

describe('JobsService.listQueuedJobs', () => {
  let tempRoot: string;
  let storageRoot: string;

  beforeEach(() => {
    const temp = createTempStorageRoot('gpt-runner-queued-jobs-');
    tempRoot = temp.tempRoot;
    storageRoot = temp.storageRoot;
    rmSync(storageRoot, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test('returns only jobs that are still queued', async () => {
    const logsStore = createLogsStoreMock();

    const jobStore = createJobStoreMock([
      {
        job_id: 'job-queued',
        goal: 'Queue the job for later execution.',
        repo_url: 'https://github.com/example/queued.git',
        status: 'queued',
        created_at: '2026-01-03T10:00:00.000Z',
        updated_at: '2026-01-03T10:00:00.000Z',
        return_code: null,
        docker_image_name: TEST_DOCKER_IMAGE,
      },
      {
        job_id: 'job-running',
        goal: 'The running job should be filtered out.',
        repo_url: 'https://github.com/example/running.git',
        status: 'running',
        created_at: '2026-01-03T11:00:00.000Z',
        updated_at: '2026-01-03T11:10:00.000Z',
        return_code: null,
        docker_image_name: TEST_DOCKER_IMAGE,
      },
    ]);
    const service = createJobsService(logsStore, storageRoot, noopScheduler, jobStore);

    assert.deepEqual(await service.listQueuedJobs(), [
      {
        job_id: 'job-queued',
        goal: 'Queue the job for later execution.',
        repo_url: 'https://github.com/example/queued.git',
        docker_image_name: TEST_DOCKER_IMAGE,
        status: 'queued',
        created_at: '2026-01-03T10:00:00.000Z',
        updated_at: '2026-01-03T10:00:00.000Z',
        return_code: null,
      },
    ]);
  });
});
