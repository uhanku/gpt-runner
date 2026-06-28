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
  InternalServerErrorException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
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

  test('returns the queued job envelope immediately', async () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

    const service = new JobsService(logsStore, storageRoot, noopScheduler);
    const response = await service.createJob(
      {
        commands: ['python3 --version'],
      },
      [],
      'https://api.example.test',
    );

    assert.match(response.job_id, /^[0-9a-f-]{36}$/i);
    assert.equal(response.status, 'queued');
    assert.equal(
      response.status_url,
      `https://api.example.test/jobs/${response.job_id}`,
    );
    assert.equal(
      response.artifacts_url,
      `https://api.example.test/jobs/${response.job_id}/artifacts`,
    );

    const statusFile = path.join(storageRoot, response.job_id, 'status.json');

    assert.ok(existsSync(statusFile));
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

      const service = new JobsService(logsStore, storageRoot, noopScheduler);
      const response = await service.createJob({
        commands: ['python3 --version'],
      });

      const storageJobDir = path.join(storageRoot, response.job_id);

      assert.ok(existsSync(path.join(storageJobDir, 'status.json')));
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

      const service = new JobsService(logsStore, storageRoot, noopScheduler);
      const response = await service.createJob(
        {
          commands: ['python3 --version'],
        },
        [],
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

  test('stores create-time uploads before scheduling the job', async () => {
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
    const response = await service.createJob(
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

  test('accepts ChatGPT file references in the validated payload', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
    });
    const result = await pipe.transform(
      {
        commands: ['cat input.txt'],
        openaiFileIdRefs: [
          {
            name: '../input.txt',
            download_link: 'https://files.example.test/input.txt',
          },
        ],
      },
      {
        type: 'body',
        metatype: CreateJobDto,
      } as never,
    );

    assert.equal(result.openaiFileIdRefs?.[0].name, '../input.txt');
    assert.equal(
      result.openaiFileIdRefs?.[0].download_link,
      'https://files.example.test/input.txt',
    );
  });

  test('rejects invalid ChatGPT file references', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
    });
    const cases = [
      {
        commands: ['cat input.txt'],
        openaiFileIdRefs: [{ download_url: 'https://files.example.test/a' }],
      },
      {
        commands: ['cat input.txt'],
        openaiFileIdRefs: [{ name: 'input.txt' }],
      },
      {
        commands: ['cat input.txt'],
        openaiFileIdRefs: [
          { name: 'input.txt', download_url: 'http://files.example.test/a' },
        ],
      },
      {
        commands: ['cat input.txt'],
        openaiFileIdRefs: Array.from({ length: 11 }, (_, index) => ({
          name: `input-${index}.txt`,
          download_url: `https://files.example.test/${index}`,
        })),
      },
    ];

    for (const payload of cases) {
      await assert.rejects(
        () =>
          pipe.transform(payload, {
            type: 'body',
            metatype: CreateJobDto,
          } as never),
        BadRequestException,
      );
    }
  });

  test('stages ChatGPT file references before scheduling the job', async () => {
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
        'downloaded before run',
      );

      return {} as NodeJS.Immediate;
    }) as typeof setImmediate;

    const fileFetch = (async (url: string) => {
      assert.equal(url, 'https://files.example.test/input.txt');
      return new Response('downloaded before run', {
        status: 200,
        headers: { 'content-length': '21' },
      });
    }) as typeof fetch;

    const service = new JobsService(logsStore, storageRoot, scheduler, fileFetch);
    const response = await service.createJob({
      commands: ['cat input.txt'],
      openaiFileIdRefs: [
        {
          name: '../input.txt',
          download_url: 'https://files.example.test/input.txt',
        },
      ],
    });

    assert.equal(scheduled, true);
    assert.match(response.job_id, /^[0-9a-f-]{36}$/i);
  });

  test('does not schedule the job when ChatGPT file download fails', async () => {
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
    const fileFetch = (async () =>
      new Response('missing', { status: 404 })) as typeof fetch;

    const service = new JobsService(logsStore, storageRoot, scheduler, fileFetch);

    await assert.rejects(
      () =>
        service.createJob({
          commands: ['cat input.txt'],
          openaiFileIdRefs: [
            {
              name: 'input.txt',
              download_url: 'https://files.example.test/input.txt',
            },
          ],
        }),
      BadRequestException,
    );
    assert.equal(scheduled, false);
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

  test('stores uploads inside the local storage workspace', async () => {
    const logsStore = {
      append: async () => undefined,
      tail: async () => '',
      deleteByJobId: async () => undefined,
      recent: async () => [],
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as unknown as JobLogsStore;

    const service = new JobsService(logsStore, storageRoot, noopScheduler);
    const { job_id } = await service.createJob({
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

describe('JobsService.listArtifacts', () => {
  const noopScheduler = (() => {
    return ((callback: (...args: any[]) => void) => {
      void callback;
      return {} as NodeJS.Immediate;
    }) as typeof setImmediate;
  })();
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

    const service = new JobsService(logsStore, storageRoot, noopScheduler);
    const { job_id } = await service.createJob({
      commands: ['python3 --version'],
    });

    const artifactsDir = path.join(storageRoot, job_id, 'artifacts');
    mkdirSync(path.join(artifactsDir, 'nested'), { recursive: true });
    writeFileSync(
      path.join(artifactsDir, 'nested', 'report one.txt'),
      'download me',
      'utf8',
    );

    const response = service.listArtifacts(job_id, 'https://api.example.test/');

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

    const file = service.getArtifactFile(
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

      const service = new JobsService(logsStore, storageRoot, noopScheduler);
      const { job_id } = await service.createJob({
        commands: ['python3 --version'],
      });

      const artifactsDir = path.join(storageRoot, job_id, 'artifacts');
      writeFileSync(path.join(artifactsDir, 'report.txt'), 'ok', 'utf8');

      const response = service.listArtifacts(
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

    const dto: CreateJobDto = {
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

    const service = new JobsService(logsStore, storageRoot, noopScheduler);
    const script = (service as unknown as {
      safeScript(dto: CreateJobDto): string;
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

    const { job_id } = await service.createJob(dto);
    const artifactsDir = path.join(storageRoot, job_id, 'artifacts');
    const outputImage = path.join(artifactsDir, 'spritefusion-pixel-snapped.png');
    writeFileSync(
      outputImage,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lB9LwQAAAABJRU5ErkJggg==',
        'base64',
      ),
    );

    const response = service.listArtifacts(job_id, 'https://api.example.test');

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

    const file = service.getArtifactFile(
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

    const service = new JobsService(logsStore, storageRoot, noopScheduler);
    const { job_id } = await service.createJob({
      commands: ['python3 --version'],
    });
    const otherJob = await service.createJob({
      commands: ['node --version'],
    });

    const artifactsDir = path.join(storageRoot, job_id, 'artifacts');
    writeFileSync(path.join(artifactsDir, 'report.txt'), 'ok', 'utf8');
    writeFileSync(path.join(artifactsDir, 'other.txt'), 'ok', 'utf8');

    const response = service.listArtifacts(job_id, 'https://api.example.test');
    const report = response.artifacts.find((artifact) => artifact.name === 'report.txt');
    assert.ok(report);
    const signature = new URL(report.download_url).searchParams.get('signature');
    assert.ok(signature);

    assert.throws(
      () => service.getArtifactFile(job_id, 'report.txt', ''),
      UnauthorizedException,
    );
    assert.throws(
      () => service.getArtifactFile(job_id, 'report.txt', 'not-hex'),
      UnauthorizedException,
    );
    assert.throws(
      () => service.getArtifactFile(job_id, 'other.txt', signature),
      UnauthorizedException,
    );
    assert.throws(
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

    const service = new JobsService(logsStore, storageRoot, noopScheduler);
    const { job_id } = await service.createJob({
      commands: ['python3 --version'],
    });

    const artifactsDir = path.join(storageRoot, job_id, 'artifacts');
    writeFileSync(path.join(artifactsDir, 'report.txt'), 'ok', 'utf8');

    assert.throws(
      () => service.listArtifacts(job_id, 'https://api.example.test'),
      InternalServerErrorException,
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
