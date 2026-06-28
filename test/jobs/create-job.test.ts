import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, afterEach, describe, test } from 'node:test';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { CreateJobDto } from '../../src/jobs/dto/create-job.dto';
import { JobsService } from '../../src/jobs/jobs.service';
import { JobLogsStore } from '../../src/jobs/job-logs.store';

describe('CreateJobDto', () => {
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
        metatype: CreateJobDto,
      } as never,
    );

    assert.ok(result instanceof CreateJobDto);
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
        metatype: CreateJobDto,
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
        metatype: CreateJobDto,
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
        metatype: CreateJobDto,
      } as never,
    );

    const jsonString = await pipe.transform(
      {
        commands: '["python3 --version","pytest"]',
      },
      {
        type: 'body',
        metatype: CreateJobDto,
      } as never,
    );

    const single = await pipe.transform(
      {
        commands: 'python3 --version',
      },
      {
        type: 'body',
        metatype: CreateJobDto,
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
            metatype: CreateJobDto,
          } as never),
        BadRequestException,
        message,
      );
    }
  });
});

describe('JobsService.createJob', () => {
  const noopScheduler = (() => {
    return ((callback: (...args: any[]) => void) => {
      void callback;
      return {} as NodeJS.Immediate;
    }) as typeof setImmediate;
  })();
  let tempRoot: string;
  let storageRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'gpt-runner-test-'));
    storageRoot = path.join(tempRoot, 'storage');
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test('returns the queued job envelope immediately', () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

    const service = new JobsService(logsStore, storageRoot, noopScheduler);
    const response = service.createJob({
      commands: ['python3 --version'],
    });

    assert.match(response.job_id, /^[0-9a-f-]{36}$/i);
    assert.equal(response.status, 'queued');
    assert.equal(response.status_url, `/jobs/${response.job_id}`);
    assert.equal(response.artifacts_url, `/jobs/${response.job_id}/artifacts`);

    const statusFile = path.join(storageRoot, response.job_id, 'status.json');

    assert.ok(existsSync(statusFile));
  });

  test('keeps host-created files under local storage even when GPT_API_ROOT is set', () => {
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

      const service = new JobsService(logsStore, storageRoot, noopScheduler);
      const response = service.createJob({
        commands: ['python3 --version'],
      });

      const storageJobDir = path.join(storageRoot, response.job_id);

      assert.ok(existsSync(path.join(storageJobDir, 'status.json')));
      assert.equal(existsSync(path.join(ignoredRoot, response.job_id)), false);
    } finally {
      delete process.env.GPT_API_ROOT;
    }
  });

  test('stores create-time uploads before scheduling the job', () => {
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

      const jobIds = readdirSync(storageRoot);
      assert.equal(jobIds.length, 1);
      assert.equal(
        readFileSync(
          path.join(storageRoot, jobIds[0], 'workspace', 'input.txt'),
          'utf8',
        ),
        'uploaded before run',
      );

      return {} as NodeJS.Immediate;
    }) as typeof setImmediate;

    const service = new JobsService(logsStore, storageRoot, scheduler);
    const response = service.createJob(
      {
        commands: ['cat input.txt'],
      },
      [
        {
          originalname: '../input.txt',
          buffer: Buffer.from('uploaded before run'),
        } as Express.Multer.File,
      ],
    );

    assert.equal(scheduled, true);
    assert.match(response.job_id, /^[0-9a-f-]{36}$/i);
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

    const service = new JobsService(logsStore);
    const script = (service as unknown as {
      safeScript(dto: CreateJobDto): string;
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

    const service = new JobsService(logsStore);
    const script = (service as unknown as {
      safeScript(dto: CreateJobDto): string;
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

    const service = new JobsService(logsStore);
    const script = (service as unknown as {
      safeScript(dto: CreateJobDto): string;
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
  const noopScheduler = (() => {
    return ((callback: (...args: any[]) => void) => {
      void callback;
      return {} as NodeJS.Immediate;
    }) as typeof setImmediate;
  })();
  let tempRoot: string;
  let storageRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'gpt-runner-upload-'));
    storageRoot = path.join(tempRoot, 'storage');
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test('stores uploads inside the local storage workspace', () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

    const service = new JobsService(logsStore, storageRoot, noopScheduler);
    const { job_id } = service.createJob({
      commands: ['python3 --version'],
    });

    const response = service.uploadFile(job_id, {
      originalname: '../report.txt',
      buffer: Buffer.from('hello world'),
    } as Express.Multer.File);

    const storedFile = path.join(
      storageRoot,
      job_id,
      'workspace',
      'report.txt',
    );

    assert.equal(response.filename, 'report.txt');
    assert.equal(response.path_inside_container, '/workspace/report.txt');
    assert.equal(readFileSync(storedFile, 'utf8'), 'hello world');
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

  test('returns summaries for persisted jobs and ignores unrelated paths', () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

    const service = new JobsService(logsStore, storageRoot);

    const olderJob = path.join(storageRoot, 'job-older');
    const newerJob = path.join(storageRoot, 'job-newer');
    const unrelatedFile = path.join(storageRoot, 'not-a-job.txt');

    mkdirSync(olderJob, { recursive: true });
    mkdirSync(newerJob, { recursive: true });
    writeFileSync(unrelatedFile, 'ignore me', 'utf8');
    mkdirSync(path.join(storageRoot, 'missing-status'), { recursive: true });

    writeFileSync(
      path.join(olderJob, 'status.json'),
      JSON.stringify(
        {
          job_id: 'job-older',
          status: 'success',
          created_at: '2026-01-01T10:00:00.000Z',
          updated_at: '2026-01-01T10:05:00.000Z',
          return_code: 0,
        },
        null,
        2,
      ),
      'utf8',
    );

    writeFileSync(
      path.join(newerJob, 'status.json'),
      JSON.stringify(
        {
          job_id: 'job-newer',
          status: 'running',
          created_at: '2026-01-02T10:00:00.000Z',
          updated_at: '2026-01-02T10:30:00.000Z',
          return_code: null,
        },
        null,
        2,
      ),
      'utf8',
    );

    const jobs = service.listJobs();

    assert.deepEqual(jobs, [
      {
        job_id: 'job-newer',
        status: 'running',
        created_at: '2026-01-02T10:00:00.000Z',
        updated_at: '2026-01-02T10:30:00.000Z',
        return_code: null,
      },
      {
        job_id: 'job-older',
        status: 'success',
        created_at: '2026-01-01T10:00:00.000Z',
        updated_at: '2026-01-01T10:05:00.000Z',
        return_code: 0,
      },
    ]);
  });
});
