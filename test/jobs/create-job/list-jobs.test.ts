import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { rmSync } from 'node:fs';
import {
  createJobStoreMock,
  createJobsService,
  createLogsStoreMock,
  createTempStorageRoot,
  noopScheduler,
  TEST_AVAILABLE_JOB_ID,
} from './shared';

describe('JobsService.listJobs', () => {
  let tempRoot: string;
  let storageRoot: string;

  beforeEach(() => {
    const temp = createTempStorageRoot('gpt-runner-jobs-');
    tempRoot = temp.tempRoot;
    storageRoot = temp.storageRoot;
    rmSync(storageRoot, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test('returns summaries for persisted jobs and ignores unrelated paths', async () => {
    const logsStore = createLogsStoreMock();

    const jobStore = createJobStoreMock([
      {
        _id: 'job-older',
        goal: 'Inspect the older job.',
        repo_url: 'https://github.com/example/older.git',
        status: 'success',
        created_at: '2026-01-01T10:00:00.000Z',
        updated_at: '2026-01-01T10:05:00.000Z',
        return_code: 0,
        available_job_id: TEST_AVAILABLE_JOB_ID,
        docker_image_name: 'gpt-runner:test-image',
      },
      {
        _id: 'job-newer',
        goal: 'Inspect the newer job.',
        repo_url: 'https://github.com/example/newer.git',
        status: 'running',
        created_at: '2026-01-02T10:00:00.000Z',
        updated_at: '2026-01-02T10:30:00.000Z',
        return_code: null,
        available_job_id: TEST_AVAILABLE_JOB_ID,
        docker_image_name: 'gpt-runner:test-image',
      },
    ]);
    const service = createJobsService(logsStore, storageRoot, noopScheduler, jobStore);

    const jobs = await service.listJobs();

    assert.deepEqual(jobs, [
      {
        _id: 'job-newer',
        goal: 'Inspect the newer job.',
        repo_url: 'https://github.com/example/newer.git',
        available_job_id: TEST_AVAILABLE_JOB_ID,
        docker_image_name: 'gpt-runner:test-image',
        status: 'running',
        created_at: '2026-01-02T10:00:00.000Z',
        updated_at: '2026-01-02T10:30:00.000Z',
        return_code: null,
      },
      {
        _id: 'job-older',
        goal: 'Inspect the older job.',
        repo_url: 'https://github.com/example/older.git',
        available_job_id: TEST_AVAILABLE_JOB_ID,
        docker_image_name: 'gpt-runner:test-image',
        status: 'success',
        created_at: '2026-01-01T10:00:00.000Z',
        updated_at: '2026-01-01T10:05:00.000Z',
        return_code: 0,
      },
    ]);
  });
});
