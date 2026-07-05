import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { rmSync } from 'node:fs';
import {
  createJobStoreMock,
  createJobsService,
  createLogsStoreMock,
  createTempStorageRoot,
  TEST_AVAILABLE_JOB_ID,
} from './shared';

describe('JobsService.getJob', () => {
  let tempRoot: string;
  let storageRoot: string;

  beforeEach(() => {
    const temp = createTempStorageRoot('gpt-runner-get-job-');
    tempRoot = temp.tempRoot;
    storageRoot = temp.storageRoot;
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test('joins the available job to restore the docker image name', async () => {
    const logsStore = createLogsStoreMock();

    const jobStore = createJobStoreMock([
      {
        _id: 'job-1',
        goal: 'Inspect the job details.',
        repo_url: 'https://github.com/example/job.git',
        status: 'queued',
        created_at: '2026-01-05T10:00:00.000Z',
        updated_at: '2026-01-05T10:00:00.000Z',
        return_code: null,
        available_job_id: TEST_AVAILABLE_JOB_ID,
      },
    ]);

    const service = createJobsService(logsStore, storageRoot, undefined, jobStore);
    const response = await service.getJob('job-1');

    assert.equal(response._id, 'job-1');
    assert.equal(response.available_job_id, TEST_AVAILABLE_JOB_ID);
    assert.equal(response.docker_image_name, 'gpt-runner:test-image');
    assert.equal(response.logs_tail, '');
  });
});
