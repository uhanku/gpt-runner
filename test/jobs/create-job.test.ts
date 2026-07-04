import 'reflect-metadata';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, afterEach, describe, test } from 'node:test';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { JobsController } from '../../src/jobs/jobs.controller';
import {
  CreateJobDto,
  StartJobDto,
  UploadJobFilesDto,
} from '../../src/jobs/dto/create-job.dto';
import { JobsService } from '../../src/jobs/jobs.service';
import { JobLogsStore } from '../../src/jobs/shared/job-logs.store';
import type { JobStatus } from '../../src/jobs/shared/job.types';

const TEST_DOCKER_IMAGE = 'gpt-runner:test-image';
const noopScheduler = (() => {
  return ((callback: (...args: any[]) => void) => {
    void callback;
    return {} as NodeJS.Immediate;
  }) as typeof setImmediate;
})();

function createJobSpec(
  overrides: Partial<{ goal: string; repo_url?: string }> = {},
) {
  return {
    goal: 'Run the repository test suite.',
    repo_url: 'https://github.com/pallets/flask.git',
    ...overrides,
  };
}

function cloneJob(job: JobStatus): JobStatus {
  return { ...job };
}

function createJobStoreMock(initialJobs: JobStatus[] = []) {
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
      [...entries.values()]
        .map(cloneJob)
        .sort((left, right) => {
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

function createJobsService(
  logsStore: JobLogsStore,
  storageRoot?: string,
  scheduler: typeof setImmediate = noopScheduler,
  fileFetchOrJobStore?: typeof fetch | ReturnType<typeof createJobStoreMock>,
  jobStore = createJobStoreMock(),
) {
  const fileFetch =
    typeof fileFetchOrJobStore === 'function' ? fileFetchOrJobStore : undefined;
  const store =
    typeof fileFetchOrJobStore === 'function'
      ? jobStore
      : fileFetchOrJobStore ?? jobStore;

  return new JobsService(
    logsStore,
    storageRoot,
    scheduler,
    fileFetch,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    store as never,
  );
}

describe('CreateJobDto', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
  });

  test('accepts the flat job payload', async () => {
    const result = await pipe.transform(
      {
        docker_image_name: TEST_DOCKER_IMAGE,
        goal: 'Run the repository tests and summarize failures.',
        repo_url: 'https://github.com/pallets/flask.git',
      },
      {
        type: 'body',
        metatype: CreateJobDto,
      } as never,
    );

    assert.ok(result instanceof CreateJobDto);
    assert.equal(
      result.goal,
      'Run the repository tests and summarize failures.',
    );
    assert.equal(result.repo_url, 'https://github.com/pallets/flask.git');
  });

  test('accepts goal without repo_url', async () => {
    const result = await pipe.transform(
      {
        docker_image_name: TEST_DOCKER_IMAGE,
        goal: 'Run the repository tests and summarize failures.',
      },
      {
        type: 'body',
        metatype: CreateJobDto,
      } as never,
    );

    assert.ok(result instanceof CreateJobDto);
    assert.equal(result.goal, 'Run the repository tests and summarize failures.');
    assert.equal(result.repo_url, undefined);
  });

  test('rejects empty and incomplete create-job payloads', async () => {
    const cases = [
      { payload: {}, message: 'docker_image_name should be required' },
      {
        payload: { docker_image_name: TEST_DOCKER_IMAGE },
        message: 'goal should be required',
      },
    ];

    for (const { payload, message } of cases) {
      await assert.rejects(
        () =>
          pipe.transform(payload, {
            type: 'body',
            metatype: CreateJobDto,
          } as never),
        BadRequestException,
        message,
      );
    }
  });
});

describe('StartJobDto', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
  });

  test('accepts the documented payload and applies defaults', async () => {
    const result = await pipe.transform(
      {
        commands: ['python3 --version'],
      },
      {
        type: 'body',
        metatype: StartJobDto,
      } as never,
    );

    assert.ok(result instanceof StartJobDto);
    assert.deepEqual(result.commands, ['python3 --version']);
    assert.equal(result.timeout_seconds, 300);
    assert.equal(result.network, 'on');
    assert.equal(result.root, false);
  });

  test('coerces the typed fields used by the API contract', async () => {
    const result = await pipe.transform(
      {
        repo_url: 'https://github.com/pallets/flask.git',
        branch: 'main',
        commands: ['pytest'],
        timeout_seconds: '120',
        network: 'off',
        root: true,
      },
      {
        type: 'body',
        metatype: StartJobDto,
      } as never,
    );

    assert.equal(result.repo_url, 'https://github.com/pallets/flask.git');
    assert.equal(result.branch, 'main');
    assert.equal(result.timeout_seconds, 120);
    assert.equal(result.network, 'off');
    assert.equal(result.root, true);
  });

  test('coerces multipart-style boolean fields predictably', async () => {
    const result = await pipe.transform(
      {
        commands: ['python3 --version'],
        root: 'false',
      },
      {
        type: 'body',
        metatype: StartJobDto,
      } as never,
    );

    assert.equal(result.root, false);
  });

  test('accepts multipart-style commands fields', async () => {
    const repeated = await pipe.transform(
      {
        commands: ['python3 --version', 'pytest'],
      },
      {
        type: 'body',
        metatype: StartJobDto,
      } as never,
    );

    const jsonString = await pipe.transform(
      {
        commands: '["python3 --version","pytest"]',
      },
      {
        type: 'body',
        metatype: StartJobDto,
      } as never,
    );

    const single = await pipe.transform(
      {
        commands: 'python3 --version',
      },
      {
        type: 'body',
        metatype: StartJobDto,
      } as never,
    );

    assert.deepEqual(repeated.commands, ['python3 --version', 'pytest']);
    assert.deepEqual(jsonString.commands, ['python3 --version', 'pytest']);
    assert.deepEqual(single.commands, ['python3 --version']);
  });

  test('rejects invalid payloads', async () => {
    const cases = [
      { payload: {}, message: 'commands should not be missing' },
      {
        payload: { commands: [] },
        message: 'commands should not accept an empty list',
      },
      {
        payload: {
          commands: Array.from({ length: 21 }, (_, index) => `echo ${index}`),
        },
        message: 'commands should be limited to 20 items',
      },
      {
        payload: { commands: ['ok'], timeout_seconds: 0 },
        message: 'timeout_seconds should be at least 1',
      },
      {
        payload: { commands: ['ok'], timeout_seconds: 901 },
        message: 'timeout_seconds should not exceed 900',
      },
      {
        payload: { commands: ['ok'], network: 'maybe' },
        message: 'network should only allow on/off',
      },
    ];

    for (const { payload, message } of cases) {
      await assert.rejects(
        () =>
          pipe.transform(payload, {
            type: 'body',
            metatype: StartJobDto,
          } as never),
        BadRequestException,
        message,
      );
    }
  });
});

describe('UploadJobFilesDto', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
  });

  test('accepts ChatGPT file reference strings in the validated payload', async () => {
    const result = await pipe.transform(
      {
        openaiFileIdRefs: ['file-service://files/input.png'],
      },
      {
        type: 'body',
        metatype: UploadJobFilesDto,
      } as never,
    );

    const firstRef = result.openaiFileIdRefs?.[0] as
      | {
          name?: string;
          download_url?: string;
          download_link?: string;
        }
      | undefined;

    assert.equal(
      firstRef?.download_url,
      'file-service://files/input.png',
    );
    assert.equal(firstRef?.download_link, 'file-service://files/input.png');
    assert.equal(firstRef?.name, 'input.png');
  });

  test('accepts ChatGPT file reference objects in the validated payload', async () => {
    const result = await pipe.transform(
      {
        openaiFileIdRefs: [
          {
            name: 'feef984b-2531-4ac6-a4c6-d8eb45097a4f.png',
            id: 'file_00000000fddc72438aa508d29872311d',
            mime_type: 'image/png',
            download_link: 'https://files.example.test/a',
          },
        ],
      },
      {
        type: 'body',
        metatype: UploadJobFilesDto,
      } as never,
    );

    const firstRef = result.openaiFileIdRefs?.[0] as
      | {
          name?: string;
          id?: string;
          mime_type?: string;
          download_url?: string;
          download_link?: string;
        }
      | undefined;

    assert.equal(
      firstRef?.name,
      'feef984b-2531-4ac6-a4c6-d8eb45097a4f.png',
    );
    assert.equal(
      firstRef?.download_link,
      'https://files.example.test/a',
    );
    assert.equal(firstRef?.id, 'file_00000000fddc72438aa508d29872311d');
    assert.equal(firstRef?.mime_type, 'image/png');
  });

  test('accepts a simple file string fallback in the validated payload', async () => {
    const result = await pipe.transform(
      {
        file: 'sediment://files/input.png',
        filename: 'source.png',
      },
      {
        type: 'body',
        metatype: UploadJobFilesDto,
      } as never,
    );

    assert.equal(result.file, 'sediment://files/input.png');
    assert.equal(result.filename, 'source.png');
  });

  test('rejects invalid ChatGPT file reference payloads', async () => {
    const cases = [
      {
        openaiFileIdRefs: [{ download_url: 'https://files.example.test/a' }],
      },
      {
        openaiFileIdRefs: [123],
      },
      {
        openaiFileIdRefs: [
          'https://files.example.test/1',
          'https://files.example.test/2',
        ],
      },
    ];

    for (const payload of cases) {
      await assert.rejects(
        () =>
          pipe.transform(payload, {
            type: 'body',
            metatype: UploadJobFilesDto,
          } as never),
        BadRequestException,
      );
    }
  });
});

describe('JobsService.createJob', () => {
  let tempRoot: string;
  let storageRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'gpt-runner-test-'));
    storageRoot = path.join(tempRoot, 'storage');
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test('returns the queued job envelope immediately', async () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

    const jobStore = createJobStoreMock();
    const service = createJobsService(logsStore, storageRoot, noopScheduler, jobStore);
    const response = await service.createJob(
      createJobSpec(),
      TEST_DOCKER_IMAGE,
      'https://api.example.test',
    );

    assert.match(response.job_id, /^[0-9a-f-]{36}$/i);
    assert.equal(response.status, 'queued');
    assert.equal(response.goal, 'Run the repository test suite.');
    assert.equal(response.repo_url, 'https://github.com/pallets/flask.git');
    assert.equal(
      response.status_url,
      `https://api.example.test/jobs/${response.job_id}`,
    );
    assert.equal(
      response.artifacts_url,
      `https://api.example.test/jobs/${response.job_id}/artifacts`,
    );

    assert.deepEqual(jobStore.entries.get(response.job_id), {
      job_id: response.job_id,
      status: 'queued',
      created_at: jobStore.entries.get(response.job_id)?.created_at,
      updated_at: jobStore.entries.get(response.job_id)?.updated_at,
      return_code: null,
      goal: 'Run the repository test suite.',
      repo_url: 'https://github.com/pallets/flask.git',
      docker_image_name: TEST_DOCKER_IMAGE,
    });
  });

  test('persists create-job metadata to the jobs collection', async () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

    const jobStore = createJobStoreMock();
    const service = createJobsService(logsStore, storageRoot, noopScheduler, jobStore);
    const response = await service.createJob(
      {
        goal: 'Collect logs for the failing build.',
        repo_url: 'https://github.com/pallets/flask.git',
      },
      TEST_DOCKER_IMAGE,
      'https://api.example.test',
    );

    assert.deepEqual(jobStore.entries.get(response.job_id), {
      job_id: response.job_id,
      status: 'queued',
      created_at: jobStore.entries.get(response.job_id)?.created_at,
      updated_at: jobStore.entries.get(response.job_id)?.updated_at,
      return_code: null,
      goal: 'Collect logs for the failing build.',
      repo_url: 'https://github.com/pallets/flask.git',
      docker_image_name: TEST_DOCKER_IMAGE,
    });
  });

  test('keeps host-created files under local storage even when GPT_API_ROOT is set', async () => {
    const ignoredRoot = path.join(tmpdir(), 'gpt-runner-ignored-root');
    process.env.GPT_API_ROOT = ignoredRoot;

    try {
      const logsStore = {
        append: async () => undefined,
        tail: async () => '',
        deleteByJobId: async () => undefined,
        recent: async () => [],
        onModuleInit: async () => undefined,
        onModuleDestroy: async () => undefined,
      } as unknown as JobLogsStore;

      const jobStore = createJobStoreMock();
      const service = createJobsService(logsStore, storageRoot, noopScheduler, jobStore);
      const response = await service.createJob(
        createJobSpec(),
        TEST_DOCKER_IMAGE,
      );

      const storageJobDir = path.join(storageRoot, response.job_id);

      assert.ok(existsSync(storageJobDir));
      assert.deepEqual(jobStore.entries.get(response.job_id)?.docker_image_name, TEST_DOCKER_IMAGE);
      assert.equal(existsSync(path.join(ignoredRoot, response.job_id)), false);
    } finally {
      delete process.env.GPT_API_ROOT;
    }
  });

  test('uses PUBLIC_BASE_URL before the request origin for response URLs', async () => {
    const previousPublicBaseUrl = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = 'https://public.example.test/';

    try {
      const logsStore = {
        append: async () => undefined,
        tail: async () => '',
        deleteByJobId: async () => undefined,
        recent: async () => [],
        onModuleInit: async () => undefined,
        onModuleDestroy: async () => undefined,
      } as unknown as JobLogsStore;

      const service = createJobsService(logsStore, storageRoot, noopScheduler);
      const response = await service.createJob(
        createJobSpec(),
        TEST_DOCKER_IMAGE,
        'https://request.example.test',
      );

      assert.equal(
        response.status_url,
        `https://public.example.test/jobs/${response.job_id}`,
      );
      assert.equal(
        response.artifacts_url,
        `https://public.example.test/jobs/${response.job_id}/artifacts`,
      );
    } finally {
      if (previousPublicBaseUrl === undefined) {
        delete process.env.PUBLIC_BASE_URL;
      } else {
        process.env.PUBLIC_BASE_URL = previousPublicBaseUrl;
      }
    }
  });

  test('does not schedule the job at create time', async () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

    let scheduled = false;
    const scheduler = ((callback: (...args: any[]) => void) => {
      void callback;
      scheduled = true;
      return {} as NodeJS.Immediate;
    }) as typeof setImmediate;

    const service = createJobsService(logsStore, storageRoot, scheduler);
    const response = await service.createJob(createJobSpec(), TEST_DOCKER_IMAGE);

    assert.equal(scheduled, false);
    assert.match(response.job_id, /^[0-9a-f-]{36}$/i);
  });
});

describe('JobsService.startJob', () => {
  let tempRoot: string;
  let storageRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'gpt-runner-start-'));
    storageRoot = path.join(tempRoot, 'storage');
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test('starts a queued job with dynamic commands', async () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

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
        commands: ['python3 --version'],
      },
      'https://api.example.test',
    );

    assert.equal(scheduled, true);
    assert.equal(response.job_id, job_id);
    assert.equal(response.status, 'running');
    assert.equal(response.goal, 'Run the repository test suite.');
    assert.equal(response.repo_url, 'https://github.com/pallets/flask.git');
    assert.equal(response.status_url, `https://api.example.test/jobs/${job_id}`);
    assert.equal(
      response.artifacts_url,
      `https://api.example.test/jobs/${job_id}/artifacts`,
    );

    assert.equal(jobStore.entries.get(job_id)?.status, 'running');
    assert.equal(jobStore.entries.get(job_id)?.return_code, null);
  });

  test('keeps stored job metadata in the start response', async () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

    const scheduler = ((callback: (...args: any[]) => void) => {
      void callback;
      return {} as NodeJS.Immediate;
    }) as typeof setImmediate;

    const service = createJobsService(logsStore, storageRoot, scheduler);
    const created = await service.createJob({
      goal: 'Run the repository tests after cloning the repo.',
      repo_url: 'https://github.com/pallets/flask.git',
    }, TEST_DOCKER_IMAGE);

    const response = await service.startJob(created.job_id, {
      commands: ['python3 --version'],
    });

    assert.equal(response.job_id, created.job_id);
    assert.equal(response.status, 'running');
    assert.equal(response.goal, 'Run the repository tests after cloning the repo.');
    assert.equal(response.repo_url, 'https://github.com/pallets/flask.git');
  });

  test('allows repeated starts after terminal statuses', async () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

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
      const stateService = createJobsService(
        logsStore,
        storageRoot,
        scheduler,
        jobStore,
      );

      const response = await stateService.startJob(job_id, {
        commands: ['echo again'],
      });
      assert.equal(response.status, 'running');
    }

    assert.equal(scheduled, 3);
  });

  test('rejects a start while the job is already running', async () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

    const scheduler = ((callback: (...args: any[]) => void) => {
      void callback;
      return {} as NodeJS.Immediate;
    }) as typeof setImmediate;

    const jobStore = createJobStoreMock();
    const service = createJobsService(logsStore, storageRoot, scheduler, jobStore);
    const { job_id } = await service.createJob(createJobSpec(), TEST_DOCKER_IMAGE);
    await service.startJob(job_id, { commands: ['python3 --version'] });

    await assert.rejects(
      () => service.startJob(job_id, { commands: ['node --version'] }),
      ConflictException,
    );
  });
});

describe('JobsService.safeScript', () => {
  test('installs pytest in the job venv when the script runs pytest', () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

    const service = createJobsService(logsStore);
    const script = (service as unknown as {
      safeScript(dto: StartJobDto): string;
    }).safeScript({
      commands: [
        'python3 --version',
        'python3 -m venv .venv',
        '. .venv/bin/activate && pytest',
      ],
    });

    assert.match(
      script,
      /python -m pip install 'pytest<9'/,
    );
    assert.match(
      script,
      /data = tomllib\.loads\(pyproject\.read_text\("utf8"\)\)/,
    );
    assert.match(
      script,
      /python -m pip install -r \/tmp\/gpt-runner-test-requirements\.txt/,
    );
    assert.ok(
      script.indexOf('python3 -m venv .venv') <
        script.indexOf("python -m pip install 'pytest<9'"),
    );
    assert.ok(
      script.indexOf("python -m pip install 'pytest<9'") <
        script.indexOf('. .venv/bin/activate && pytest'),
    );
  });

  test('guards pytest bootstrap when no venv setup command is present', () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

    const service = createJobsService(logsStore);
    const script = (service as unknown as {
      safeScript(dto: StartJobDto): string;
    }).safeScript({
      commands: ['python3 --version', 'pytest'],
    });

    assert.match(
      script,
      /python -m pip install 'pytest<9'/,
    );
    assert.ok(
      script.indexOf("python -m pip install 'pytest<9'") <
        script.indexOf('\npytest'),
    );
  });

  test('does not add pytest bootstrap for non-pytest scripts', () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

    const service = createJobsService(logsStore);
    const script = (service as unknown as {
      safeScript(dto: StartJobDto): string;
    }).safeScript({
      commands: ['python3 --version', 'echo done'],
    });

    assert.doesNotMatch(
      script,
      /python -m pip install 'pytest<9'/,
    );
  });
});

describe('JobsService.uploadFile', () => {
  let tempRoot: string;
  let storageRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'gpt-runner-upload-'));
    storageRoot = path.join(tempRoot, 'storage');
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test('stores uploads as input.png inside the local storage workspace', async () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

    const service = createJobsService(logsStore, storageRoot, noopScheduler);
    const { job_id } = await service.createJob(createJobSpec(), TEST_DOCKER_IMAGE);

    const response = await service.uploadFile(
      job_id,
      {},
      [
        {
          originalname: '../report.txt',
          buffer: Buffer.from('hello world'),
        } as Express.Multer.File,
      ],
    );

    const storedFile = path.join(
      storageRoot,
      job_id,
      'workspace',
      'input.png',
    );

    assert.equal(response.filename, 'input.png');
    assert.equal(response.path_inside_container, '/workspace/input.png');
    assert.equal(readFileSync(storedFile, 'utf8'), 'hello world');
  });

  test('stores ChatGPT file references as input.png', async () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

    const fileFetch = (async (url: string) => {
      assert.equal(url, 'https://files.example.test/input.png');
      return new Response('downloaded input', {
        status: 200,
        headers: { 'content-length': '16' },
      });
    }) as typeof fetch;

    const service = createJobsService(
      logsStore,
      storageRoot,
      noopScheduler,
      fileFetch,
    );
    const { job_id } = await service.createJob(createJobSpec(), TEST_DOCKER_IMAGE);

    const response = await service.uploadFile(job_id, {
      openaiFileIdRefs: ['https://files.example.test/input.png'],
      filename: '../ignored-name.png',
    });

    const storedFile = path.join(
      storageRoot,
      job_id,
      'workspace',
      'input.png',
    );

    assert.equal(response.filename, 'input.png');
    assert.equal(response.path_inside_container, '/workspace/input.png');
    assert.equal(readFileSync(storedFile, 'utf8'), 'downloaded input');
  });

  test('stores ChatGPT file reference objects as input.png', async () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

    const fileFetch = (async (url: string) => {
      assert.equal(url, 'https://files.example.test/object-input.png');
      return new Response('downloaded object input', {
        status: 200,
        headers: { 'content-length': '23' },
      });
    }) as typeof fetch;

    const service = createJobsService(
      logsStore,
      storageRoot,
      noopScheduler,
      fileFetch,
    );
    const { job_id } = await service.createJob(createJobSpec(), TEST_DOCKER_IMAGE);

    const response = await service.uploadFile(job_id, {
      openaiFileIdRefs: [
        {
          name: 'feef984b-2531-4ac6-a4c6-d8eb45097a4f.png',
          id: 'file_00000000fddc72438aa508d29872311d',
          mime_type: 'image/png',
          download_link: 'https://files.example.test/object-input.png',
        },
      ],
      filename: '../ignored-name.png',
    });

    const storedFile = path.join(
      storageRoot,
      job_id,
      'workspace',
      'input.png',
    );

    assert.equal(response.filename, 'input.png');
    assert.equal(response.path_inside_container, '/workspace/input.png');
    assert.equal(readFileSync(storedFile, 'utf8'), 'downloaded object input');
  });

  test('stores the simple file string fallback as input.png', async () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

    const fileFetch = (async (url: string) => {
      assert.equal(url, 'sediment://files/input.png');
      return new Response('fallback input', {
        status: 200,
        headers: { 'content-length': '14' },
      });
    }) as typeof fetch;

    const service = createJobsService(
      logsStore,
      storageRoot,
      noopScheduler,
      fileFetch,
    );
    const { job_id } = await service.createJob(createJobSpec(), TEST_DOCKER_IMAGE);

    const response = await service.uploadFile(job_id, {
      file: 'sediment://files/input.png',
      filename: 'source.png',
    });

    const storedFile = path.join(
      storageRoot,
      job_id,
      'workspace',
      'input.png',
    );

    assert.equal(response.filename, 'input.png');
    assert.equal(response.path_inside_container, '/workspace/input.png');
    assert.equal(readFileSync(storedFile, 'utf8'), 'fallback input');
  });

  test('rejects missing and multiple file inputs', async () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

    const service = createJobsService(logsStore, storageRoot, noopScheduler);
    const { job_id } = await service.createJob(createJobSpec(), TEST_DOCKER_IMAGE);

    await assert.rejects(
      () => service.uploadFile(job_id, {}, []),
      BadRequestException,
    );

    await assert.rejects(
      () =>
        service.uploadFile(
          job_id,
          {
            openaiFileIdRefs: ['https://files.example.test/input.png'],
          },
          [
            {
              originalname: 'input.png',
              buffer: Buffer.from('upload'),
            } as Express.Multer.File,
          ],
        ),
      BadRequestException,
    );
  });

  test('rejects failed and oversized referenced downloads', async () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

    const failedFetch = (async () =>
      new Response('missing', { status: 404 })) as typeof fetch;
    const failedService = createJobsService(
      logsStore,
      storageRoot,
      noopScheduler,
      failedFetch,
    );
    const failedJob = await failedService.createJob(
      createJobSpec(),
      TEST_DOCKER_IMAGE,
    );

    await assert.rejects(
      () =>
        failedService.uploadFile(failedJob.job_id, {
          openaiFileIdRefs: ['https://files.example.test/missing.png'],
        }),
      BadRequestException,
    );

    const oversizedFetch = (async () =>
      new Response('too big', {
        status: 200,
        headers: { 'content-length': String(51 * 1024 * 1024) },
      })) as typeof fetch;
    const oversizedService = createJobsService(
      logsStore,
      storageRoot,
      noopScheduler,
      oversizedFetch,
    );
    const oversizedJob = await oversizedService.createJob(
      createJobSpec(),
      TEST_DOCKER_IMAGE,
    );

    await assert.rejects(
      () =>
        oversizedService.uploadFile(oversizedJob.job_id, {
          openaiFileIdRefs: ['https://files.example.test/large.png'],
        }),
      BadRequestException,
    );
  });

  test('rejects uploads while the job is running', async () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

    const service = createJobsService(logsStore, storageRoot, noopScheduler);
    const { job_id } = await service.createJob(createJobSpec(), TEST_DOCKER_IMAGE);
    await service.startJob(job_id, { commands: ['python3 --version'] });

    await assert.rejects(
      () =>
        service.uploadFile(
          job_id,
          {},
          [
            {
              originalname: 'input.png',
              buffer: Buffer.from('upload'),
            } as Express.Multer.File,
          ],
        ),
      ConflictException,
    );
  });
});

describe('JobsService.listArtifacts', () => {
  let tempRoot: string;
  let storageRoot: string;
  let previousPublicArtifactSecret: string | undefined;

  beforeEach(() => {
    previousPublicArtifactSecret = process.env.PUBLIC_ARTIFACT_SECRET;
    process.env.PUBLIC_ARTIFACT_SECRET = 'test-public-artifact-secret';
    tempRoot = mkdtempSync(path.join(tmpdir(), 'gpt-runner-artifacts-'));
    storageRoot = path.join(tempRoot, 'storage');
  });

  afterEach(() => {
    if (previousPublicArtifactSecret === undefined) {
      delete process.env.PUBLIC_ARTIFACT_SECRET;
    } else {
      process.env.PUBLIC_ARTIFACT_SECRET = previousPublicArtifactSecret;
    }

    rmSync(tempRoot, { recursive: true, force: true });
  });

  test('returns absolute download URLs from the request origin', async () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

    const service = createJobsService(logsStore, storageRoot, noopScheduler);
    const { job_id } = await service.createJob(createJobSpec(), TEST_DOCKER_IMAGE);

    const artifactsDir = path.join(storageRoot, job_id, 'artifacts');
    mkdirSync(path.join(artifactsDir, 'nested'), { recursive: true });
    writeFileSync(
      path.join(artifactsDir, 'nested', 'report one.txt'),
      'download me',
      'utf8',
    );

    const response = await service.listArtifacts(job_id, 'https://api.example.test/');

    assert.equal(response.job_id, job_id);
    assert.equal(response.artifacts.length, 1);
    assert.equal(response.artifacts[0].name, 'nested/report one.txt');
    assert.equal(response.artifacts[0].size_bytes, 11);

    const downloadUrl = new URL(response.artifacts[0].download_url);
    assert.equal(
      downloadUrl.origin + downloadUrl.pathname,
      `https://api.example.test/jobs/${job_id}/artifact`,
    );
    assert.equal(downloadUrl.searchParams.get('path'), 'nested/report one.txt');
    assert.match(downloadUrl.searchParams.get('signature') || '', /^[0-9a-f]{64}$/);

    const file = await service.getArtifactFile(
      job_id,
      'nested/report one.txt',
      downloadUrl.searchParams.get('signature') || '',
    );
    assert.equal(
      file.absolutePath,
      path.join(artifactsDir, 'nested', 'report one.txt'),
    );
  });

  test('uses PUBLIC_BASE_URL before the request origin for artifact URLs', async () => {
    const previousPublicBaseUrl = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = 'https://public.example.test/';

    try {
      const logsStore = {
        append: async () => undefined,
        tail: async () => '',
        deleteByJobId: async () => undefined,
        recent: async () => [],
        onModuleInit: async () => undefined,
        onModuleDestroy: async () => undefined,
      } as unknown as JobLogsStore;

      const service = createJobsService(logsStore, storageRoot, noopScheduler);
      const { job_id } = await service.createJob(createJobSpec(), TEST_DOCKER_IMAGE);

      const artifactsDir = path.join(storageRoot, job_id, 'artifacts');
      writeFileSync(path.join(artifactsDir, 'report.txt'), 'ok', 'utf8');

      const response = await service.listArtifacts(
        job_id,
        'https://request.example.test',
      );

      assert.equal(
        response.artifacts[0].download_url,
        `https://public.example.test/jobs/${job_id}/artifact?path=report.txt&signature=${new URL(
          response.artifacts[0].download_url,
        ).searchParams.get('signature')}`,
      );
    } finally {
      if (previousPublicBaseUrl === undefined) {
        delete process.env.PUBLIC_BASE_URL;
      } else {
        process.env.PUBLIC_BASE_URL = previousPublicBaseUrl;
      }
    }
  });

  test('returns a downloadable image URL for a SpriteFusion pixel snapper output', async () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

    const dto: StartJobDto = {
      repo_url: 'https://github.com/Hugo-Dz/spritefusion-pixel-snapper.git',
      commands: [
        [
          'convert',
          '-size 16x16 xc:none',
          '-fill "#d33b32" -draw "rectangle 0,0 7,7"',
          '-fill "#d8443a" -draw "rectangle 8,0 15,7"',
          '-fill "#315bd8" -draw "rectangle 0,8 7,15"',
          '-fill "#3b64df" -draw "rectangle 8,8 15,15"',
          'mixed-pixel-art.png',
        ].join(' '),
        'cargo run --release -- mixed-pixel-art.png /artifacts/spritefusion-pixel-snapped.png 4 --pixel-size 8',
      ],
    };

    const service = createJobsService(logsStore, storageRoot, noopScheduler);
    const script = (service as unknown as {
      safeScript(dto: StartJobDto): string;
    }).safeScript(dto);

    assert.match(
      script,
      /git clone 'https:\/\/github\.com\/Hugo-Dz\/spritefusion-pixel-snapper\.git' repo/,
    );
    assert.match(script, /convert .*mixed-pixel-art\.png/);
    assert.match(
      script,
      /cargo run --release -- mixed-pixel-art\.png \/artifacts\/spritefusion-pixel-snapped\.png 4 --pixel-size 8/,
    );

    const { job_id } = await service.createJob(createJobSpec(), TEST_DOCKER_IMAGE);
    const artifactsDir = path.join(storageRoot, job_id, 'artifacts');
    const outputImage = path.join(artifactsDir, 'spritefusion-pixel-snapped.png');
    writeFileSync(
      outputImage,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lB9LwQAAAABJRU5ErkJggg==',
        'base64',
      ),
    );

    const response = await service.listArtifacts(job_id, 'https://api.example.test');

    assert.equal(response.artifacts.length, 1);
    assert.equal(
      response.artifacts[0].name,
      'spritefusion-pixel-snapped.png',
    );
    assert.equal(response.artifacts[0].size_bytes, statSync(outputImage).size);

    const downloadUrl = new URL(response.artifacts[0].download_url);
    assert.equal(
      downloadUrl.origin + downloadUrl.pathname,
      `https://api.example.test/jobs/${job_id}/artifact`,
    );
    assert.equal(
      downloadUrl.searchParams.get('path'),
      'spritefusion-pixel-snapped.png',
    );
    assert.match(downloadUrl.searchParams.get('signature') || '', /^[0-9a-f]{64}$/);

    const file = await service.getArtifactFile(
      job_id,
      'spritefusion-pixel-snapped.png',
      downloadUrl.searchParams.get('signature') || '',
    );

    assert.equal(file.absolutePath, outputImage);
    assert.equal(file.filename, 'spritefusion-pixel-snapped.png');
  });

  test('rejects missing or mismatched artifact signatures', async () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

    const service = createJobsService(logsStore, storageRoot, noopScheduler);
    const { job_id } = await service.createJob(createJobSpec(), TEST_DOCKER_IMAGE);
    const otherJob = await service.createJob(createJobSpec(), TEST_DOCKER_IMAGE);

    const artifactsDir = path.join(storageRoot, job_id, 'artifacts');
    writeFileSync(path.join(artifactsDir, 'report.txt'), 'ok', 'utf8');
    writeFileSync(path.join(artifactsDir, 'other.txt'), 'ok', 'utf8');

    const response = await service.listArtifacts(job_id, 'https://api.example.test');
    const report = response.artifacts.find((artifact) => artifact.name === 'report.txt');
    assert.ok(report);
    const signature = new URL(report.download_url).searchParams.get('signature');
    assert.ok(signature);

    await assert.rejects(
      () => service.getArtifactFile(job_id, 'report.txt', ''),
      UnauthorizedException,
    );
    await assert.rejects(
      () => service.getArtifactFile(job_id, 'report.txt', 'not-hex'),
      UnauthorizedException,
    );
    await assert.rejects(
      () => service.getArtifactFile(job_id, 'other.txt', signature),
      UnauthorizedException,
    );
    await assert.rejects(
      () => service.getArtifactFile(otherJob.job_id, 'report.txt', signature),
      UnauthorizedException,
    );
  });

  test('requires PUBLIC_ARTIFACT_SECRET to generate artifact URLs', async () => {
    delete process.env.PUBLIC_ARTIFACT_SECRET;

    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

    const service = createJobsService(logsStore, storageRoot, noopScheduler);
    const { job_id } = await service.createJob(createJobSpec(), TEST_DOCKER_IMAGE);

    const artifactsDir = path.join(storageRoot, job_id, 'artifacts');
    writeFileSync(path.join(artifactsDir, 'report.txt'), 'ok', 'utf8');

    await assert.rejects(
      () => service.listArtifacts(job_id, 'https://api.example.test'),
      InternalServerErrorException,
    );
  });
});

describe('Swagger docs', () => {
  test('prefills the SpriteFusion repo workflow on the start-job request body', async () => {
    const metadata = Reflect.getMetadata(
      'swagger/apiParameters',
      JobsController.prototype.startJob,
    ) as Array<{ in?: string; schema?: { example?: unknown } }>;

    const bodyMetadata = metadata?.find((entry) => entry.in === 'body');

    assert.ok(bodyMetadata);
    assert.deepEqual(bodyMetadata?.schema?.example, {
      repo_url: 'https://github.com/Hugo-Dz/spritefusion-pixel-snapper.git',
      commands: ['ls -la'],
    });
  });

  test('documents the queued jobs list route', async () => {
    const metadata = Reflect.getMetadata(
      'swagger/apiResponse',
      JobsController.prototype.listQueuedJobs,
    ) as Record<string, { schema?: { type?: string; items?: { properties?: Record<string, unknown> } } }>;

    const okResponse = metadata['200'];

    assert.ok(okResponse);
    assert.equal(okResponse.schema?.type, 'array');
    assert.equal(
      (okResponse.schema?.items?.properties?.status as { type?: string } | undefined)?.type,
      'string',
    );
    assert.deepEqual(
      (okResponse.schema?.items?.properties?.status as { enum?: string[] } | undefined)?.enum,
      ['queued', 'running', 'success', 'failed', 'timeout', 'deleted'],
    );
    assert.deepEqual(
      Reflect.getMetadata('path', JobsController.prototype.listQueuedJobs),
      'queued',
    );
  });
});

describe('JobsService.listJobs', () => {
  let tempRoot: string;
  let storageRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'gpt-runner-jobs-'));
    storageRoot = path.join(tempRoot, 'storage');
    rmSync(storageRoot, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test('returns summaries for persisted jobs and ignores unrelated paths', async () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

    const jobStore = createJobStoreMock([
      {
        job_id: 'job-older',
        goal: 'Inspect the older job.',
        repo_url: 'https://github.com/example/older.git',
        status: 'success',
        created_at: '2026-01-01T10:00:00.000Z',
        updated_at: '2026-01-01T10:05:00.000Z',
        return_code: 0,
        docker_image_name: TEST_DOCKER_IMAGE,
      },
      {
        job_id: 'job-newer',
        goal: 'Inspect the newer job.',
        repo_url: 'https://github.com/example/newer.git',
        status: 'running',
        created_at: '2026-01-02T10:00:00.000Z',
        updated_at: '2026-01-02T10:30:00.000Z',
        return_code: null,
        docker_image_name: TEST_DOCKER_IMAGE,
      },
    ]);
    const service = createJobsService(logsStore, storageRoot, noopScheduler, jobStore);

    const jobs = await service.listJobs();

    assert.deepEqual(jobs, [
      {
        job_id: 'job-newer',
        goal: 'Inspect the newer job.',
        repo_url: 'https://github.com/example/newer.git',
        docker_image_name: TEST_DOCKER_IMAGE,
        status: 'running',
        created_at: '2026-01-02T10:00:00.000Z',
        updated_at: '2026-01-02T10:30:00.000Z',
        return_code: null,
      },
      {
        job_id: 'job-older',
        goal: 'Inspect the older job.',
        repo_url: 'https://github.com/example/older.git',
        docker_image_name: TEST_DOCKER_IMAGE,
        status: 'success',
        created_at: '2026-01-01T10:00:00.000Z',
        updated_at: '2026-01-01T10:05:00.000Z',
        return_code: 0,
      },
    ]);
  });
});

describe('JobsService.listQueuedJobs', () => {
  let tempRoot: string;
  let storageRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'gpt-runner-queued-jobs-'));
    storageRoot = path.join(tempRoot, 'storage');
    rmSync(storageRoot, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test('returns only jobs that are still queued', async () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

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
