import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { RunJobCommandsDto, StartJobDto } from '../../../src/jobs/dto/create-job.dto';
import {
  createJobSpec,
  createJobStoreMock,
  createJobsService,
  createLogsStoreMock,
  createTempStorageRoot,
  TEST_DOCKER_IMAGE,
} from './shared';

describe('JobsService.startJob', () => {
  let tempRoot: string;
  let storageRoot: string;

  beforeEach(() => {
    const temp = createTempStorageRoot('gpt-runner-start-');
    tempRoot = temp.tempRoot;
    storageRoot = temp.storageRoot;
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test('boots a queued job workspace', async () => {
    const logsStore = createLogsStoreMock();

    let scheduled = false;
    const scheduler = ((callback: (...args: any[]) => void) => {
      void callback;
      scheduled = true;
      return {} as NodeJS.Immediate;
    }) as typeof setImmediate;

    const jobStore = createJobStoreMock();
    const service = createJobsService(logsStore, storageRoot, scheduler, jobStore);
    const { job_id } = await service.createJob(createJobSpec(), TEST_DOCKER_IMAGE);
    const response = await service.startJob(
      job_id,
      {
        repo_url: 'https://github.com/pallets/flask.git',
      },
      'https://api.example.test',
    );

    assert.equal(scheduled, true);
    assert.equal(response.job_id, job_id);
    assert.equal(response.status, 'running');
    assert.equal(response.goal, 'Run the repository test suite.');
    assert.equal(response.repo_url, 'https://github.com/pallets/flask.git');
    assert.equal(response.status_url, `https://api.example.test/jobs/${job_id}`);
    assert.equal(response.artifacts_url, `https://api.example.test/jobs/${job_id}/artifacts`);

    assert.equal(jobStore.entries.get(job_id)?.status, 'running');
    assert.equal(jobStore.entries.get(job_id)?.return_code, null);
  });

  test('keeps stored job metadata in the start response', async () => {
    const logsStore = createLogsStoreMock();

    const scheduler = ((callback: (...args: any[]) => void) => {
      void callback;
      return {} as NodeJS.Immediate;
    }) as typeof setImmediate;

    const service = createJobsService(logsStore, storageRoot, scheduler);
    const created = await service.createJob(
      {
        goal: 'Run the repository tests after cloning the repo.',
        repo_url: 'https://github.com/pallets/flask.git',
      },
      TEST_DOCKER_IMAGE,
    );

    const response = await service.startJob(created.job_id, {});

    assert.equal(response.job_id, created.job_id);
    assert.equal(response.status, 'running');
    assert.equal(response.goal, 'Run the repository tests after cloning the repo.');
    assert.equal(response.repo_url, 'https://github.com/pallets/flask.git');
  });

  test('allows repeated starts after terminal statuses', async () => {
    const logsStore = createLogsStoreMock();

    let scheduled = 0;
    const scheduler = ((callback: (...args: any[]) => void) => {
      void callback;
      scheduled += 1;
      return {} as NodeJS.Immediate;
    }) as typeof setImmediate;

    const service = createJobsService(logsStore, storageRoot, scheduler);

    for (const state of ['success', 'failed', 'timeout'] as const) {
      const job_id = `job-${state}`;
      const jobStore = createJobStoreMock([
        {
          job_id,
          status: state,
          created_at: '2026-01-01T10:00:00.000Z',
          updated_at: '2026-01-01T10:05:00.000Z',
          return_code: 1,
          goal: 'Queue the job for later execution.',
          repo_url: 'https://github.com/example/queued.git',
          docker_image_name: TEST_DOCKER_IMAGE,
        },
      ]);
      const stateService = createJobsService(logsStore, storageRoot, scheduler, jobStore);

      const response = await stateService.startJob(job_id, {
        repo_url: 'https://github.com/example/queued.git',
      });
      assert.equal(response.status, 'running');
    }

    assert.equal(scheduled, 3);
  });

  test('rejects a start while the job is already running', async () => {
    const logsStore = createLogsStoreMock();

    const scheduler = ((callback: (...args: any[]) => void) => {
      void callback;
      return {} as NodeJS.Immediate;
    }) as typeof setImmediate;

    const jobStore = createJobStoreMock();
    const service = createJobsService(logsStore, storageRoot, scheduler, jobStore);
    const { job_id } = await service.createJob(createJobSpec(), TEST_DOCKER_IMAGE);
    await service.startJob(job_id, {});

    await assert.rejects(() => service.startJob(job_id, {}), ConflictException);
  });
});

describe('JobsService.bootstrapScript', () => {
  test('clones the repo and installs workspace dependencies when present', () => {
    const logsStore = createLogsStoreMock();
    const service = createJobsService(logsStore);
    const script = (
      service as unknown as {
        bootstrapScript(dto: StartJobDto): string;
      }
    ).bootstrapScript({
      repo_url: 'https://github.com/pallets/flask.git',
    });

    assert.match(script, /git clone 'https:\/\/github\.com\/pallets\/flask\.git' repo/);
    assert.match(script, /cargo fetch/);
    assert.match(script, /python -m pip install -e \./);
    assert.doesNotMatch(script, /python -m pip install 'pytest<9'/);
  });
});

describe('JobsService.commandsScript', () => {
  test('starts directly with commands when no repo URL is provided', () => {
    const logsStore = createLogsStoreMock();
    const service = createJobsService(logsStore);
    const script = (
      service as unknown as {
        commandsScript(dto: RunJobCommandsDto): string;
      }
    ).commandsScript({
      commands: ['python3 --version', 'pytest'],
    });

    assert.doesNotMatch(script, /git clone/);
    assert.match(script, /if \[ -d repo \]; then/);
    assert.match(script, /\n  cd repo\n/);
    assert.ok(script.indexOf("echo '[gpt-runner] running commands'") < script.indexOf('\npython3 --version'));
  });

  test('installs pytest in the job venv when the script runs pytest', () => {
    const logsStore = createLogsStoreMock();
    const service = createJobsService(logsStore);
    const script = (
      service as unknown as {
        commandsScript(dto: RunJobCommandsDto): string;
      }
    ).commandsScript({
      commands: ['python3 --version', 'python3 -m venv .venv', '. .venv/bin/activate && pytest'],
    });

    assert.match(script, /python -m pip install 'pytest<9'/);
    assert.match(script, /data = tomllib\.loads\(pyproject\.read_text\("utf8"\)\)/);
    assert.match(script, /python -m pip install -r \/tmp\/gpt-runner-test-requirements\.txt/);
    assert.ok(script.indexOf('python3 -m venv .venv') < script.indexOf("python -m pip install 'pytest<9'"));
    assert.ok(script.indexOf("python -m pip install 'pytest<9'") < script.indexOf('. .venv/bin/activate && pytest'));
  });

  test('guards pytest bootstrap when no venv setup command is present', () => {
    const logsStore = createLogsStoreMock();
    const service = createJobsService(logsStore);
    const script = (
      service as unknown as {
        commandsScript(dto: RunJobCommandsDto): string;
      }
    ).commandsScript({
      commands: ['python3 --version', 'pytest'],
    });

    assert.match(script, /python -m pip install 'pytest<9'/);
    assert.ok(script.indexOf("python -m pip install 'pytest<9'") < script.indexOf('\npytest'));
  });

  test('does not add pytest bootstrap for non-pytest scripts', () => {
    const logsStore = createLogsStoreMock();
    const service = createJobsService(logsStore);
    const script = (
      service as unknown as {
        commandsScript(dto: RunJobCommandsDto): string;
      }
    ).commandsScript({
      commands: ['python3 --version', 'echo done'],
    });

    assert.doesNotMatch(script, /python -m pip install 'pytest<9'/);
  });
});
