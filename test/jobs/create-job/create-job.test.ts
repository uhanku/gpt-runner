import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  createJobSpec,
  createJobStoreMock,
  createJobsService,
  createLogsStoreMock,
  createTempStorageRoot,
  noopScheduler,
  TEST_AVAILABLE_JOB_ID,
} from './shared';

describe('JobsService.createJob', () => {
  let tempRoot: string;
  let storageRoot: string;

  beforeEach(() => {
    const temp = createTempStorageRoot('gpt-runner-test-');
    tempRoot = temp.tempRoot;
    storageRoot = temp.storageRoot;
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test('returns the queued job envelope immediately', async () => {
    const logsStore = createLogsStoreMock();
    const jobStore = createJobStoreMock();
    const service = createJobsService(logsStore, storageRoot, noopScheduler, jobStore);
    const response = await service.createJob(createJobSpec(), TEST_AVAILABLE_JOB_ID, 'https://api.example.test');

    assert.match(response._id, /^[0-9a-f]{24}$/i);
    assert.equal(response.status, 'queued');
    assert.equal(response.goal, 'Run the repository test suite.');
    assert.equal(response.repo_url, 'https://github.com/pallets/flask.git');
    assert.equal(response.status_url, `https://api.example.test/jobs/${response._id}`);
    assert.equal(response.artifacts_url, `https://api.example.test/jobs/${response._id}/artifacts`);

    assert.deepEqual(jobStore.entries.get(response._id), {
      _id: response._id,
      status: 'queued',
      created_at: jobStore.entries.get(response._id)?.created_at,
      updated_at: jobStore.entries.get(response._id)?.updated_at,
      return_code: null,
      goal: 'Run the repository test suite.',
      repo_url: 'https://github.com/pallets/flask.git',
      available_job_id: TEST_AVAILABLE_JOB_ID,
      docker_image_name: 'gpt-runner:test-image',
    });
  });

  test('persists create-job metadata to the jobs collection', async () => {
    const logsStore = createLogsStoreMock();
    const jobStore = createJobStoreMock();
    const service = createJobsService(logsStore, storageRoot, noopScheduler, jobStore);
    const response = await service.createJob(
      {
        goal: 'Collect logs for the failing build.',
        repo_url: 'https://github.com/pallets/flask.git',
      },
      TEST_AVAILABLE_JOB_ID,
      'https://api.example.test',
    );

    assert.deepEqual(jobStore.entries.get(response._id), {
      _id: response._id,
      status: 'queued',
      created_at: jobStore.entries.get(response._id)?.created_at,
      updated_at: jobStore.entries.get(response._id)?.updated_at,
      return_code: null,
      goal: 'Collect logs for the failing build.',
      repo_url: 'https://github.com/pallets/flask.git',
      available_job_id: TEST_AVAILABLE_JOB_ID,
      docker_image_name: 'gpt-runner:test-image',
    });
  });

  test('keeps host-created files under local storage even when GPT_API_ROOT is set', async () => {
    const ignoredRoot = path.join(tmpdir(), 'gpt-runner-ignored-root');
    process.env.GPT_API_ROOT = ignoredRoot;

    try {
      const logsStore = createLogsStoreMock();
      const jobStore = createJobStoreMock();
      const service = createJobsService(logsStore, storageRoot, noopScheduler, jobStore);
      const response = await service.createJob(createJobSpec(), TEST_AVAILABLE_JOB_ID);

      const storageJobDir = path.join(storageRoot, response._id);

      assert.ok(existsSync(storageJobDir));
      assert.deepEqual(jobStore.entries.get(response._id)?.available_job_id, TEST_AVAILABLE_JOB_ID);
      assert.equal(existsSync(path.join(ignoredRoot, response._id)), false);
    } finally {
      delete process.env.GPT_API_ROOT;
    }
  });

  test('uses PUBLIC_BASE_URL before the request origin for response URLs', async () => {
    const previousPublicBaseUrl = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = 'https://public.example.test/';

    try {
      const logsStore = createLogsStoreMock();
      const service = createJobsService(logsStore, storageRoot, noopScheduler);
      const response = await service.createJob(createJobSpec(), TEST_AVAILABLE_JOB_ID, 'https://request.example.test');

      assert.equal(response.status_url, `https://public.example.test/jobs/${response._id}`);
      assert.equal(response.artifacts_url, `https://public.example.test/jobs/${response._id}/artifacts`);
    } finally {
      if (previousPublicBaseUrl === undefined) {
        delete process.env.PUBLIC_BASE_URL;
      } else {
        process.env.PUBLIC_BASE_URL = previousPublicBaseUrl;
      }
    }
  });

  test('does not schedule the job at create time', async () => {
    const logsStore = createLogsStoreMock();

    let scheduled = false;
    const scheduler = ((callback: (...args: any[]) => void) => {
      void callback;
      scheduled = true;
      return {} as NodeJS.Immediate;
    }) as typeof setImmediate;

    const service = createJobsService(logsStore, storageRoot, scheduler);
    const response = await service.createJob(createJobSpec(), TEST_AVAILABLE_JOB_ID);

    assert.equal(scheduled, false);
    assert.match(response._id, /^[0-9a-f]{24}$/i);
  });
});
