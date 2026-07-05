import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateJobDto, RunJobCommandsDto, StartJobDto, UploadJobFilesDto } from '../../../src/jobs/dto/create-job.dto';
import { TEST_DOCKER_IMAGE } from './shared';

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
    assert.equal(result.goal, 'Run the repository tests and summarize failures.');
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
        repo_url: 'https://github.com/pallets/flask.git',
      },
      {
        type: 'body',
        metatype: StartJobDto,
      } as never,
    );

    assert.ok(result instanceof StartJobDto);
    assert.equal(result.repo_url, 'https://github.com/pallets/flask.git');
    assert.equal(result.timeout_seconds, 300);
    assert.equal(result.network, 'on');
    assert.equal(result.root, false);
  });

  test('coerces the typed fields used by the API contract', async () => {
    const result = await pipe.transform(
      {
        repo_url: 'https://github.com/pallets/flask.git',
        branch: 'main',
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
        root: 'false',
      },
      {
        type: 'body',
        metatype: StartJobDto,
      } as never,
    );

    assert.equal(result.root, false);
  });

  test('rejects invalid bootstrap payloads', async () => {
    const cases = [
      {
        payload: { repo_url: 123 },
        message: 'repo_url should be a string when present',
      },
      {
        payload: { branch: 123 },
        message: 'branch should be a string when present',
      },
      {
        payload: { timeout_seconds: 0 },
        message: 'timeout_seconds should be at least 1',
      },
      {
        payload: { timeout_seconds: 901 },
        message: 'timeout_seconds should not exceed 900',
      },
      {
        payload: { network: 'maybe' },
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

describe('RunJobCommandsDto', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
  });

  test('accepts multipart-style commands fields', async () => {
    const repeated = await pipe.transform(
      {
        commands: ['python3 --version', 'pytest'],
      },
      {
        type: 'body',
        metatype: RunJobCommandsDto,
      } as never,
    );

    const jsonString = await pipe.transform(
      {
        commands: '["python3 --version","pytest"]',
      },
      {
        type: 'body',
        metatype: RunJobCommandsDto,
      } as never,
    );

    const single = await pipe.transform(
      {
        commands: 'python3 --version',
      },
      {
        type: 'body',
        metatype: RunJobCommandsDto,
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
            metatype: RunJobCommandsDto,
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

    assert.equal(firstRef?.download_url, 'file-service://files/input.png');
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

    assert.equal(firstRef?.name, 'feef984b-2531-4ac6-a4c6-d8eb45097a4f.png');
    assert.equal(firstRef?.download_link, 'https://files.example.test/a');
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
        openaiFileIdRefs: ['https://files.example.test/1', 'https://files.example.test/2'],
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
