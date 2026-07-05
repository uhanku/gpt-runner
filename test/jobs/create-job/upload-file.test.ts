import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  createJobSpec,
  createJobsService,
  createLogsStoreMock,
  createTempStorageRoot,
  noopScheduler,
  TEST_AVAILABLE_JOB_ID,
} from './shared';

describe('JobsService.uploadFile', () => {
  let tempRoot: string;
  let storageRoot: string;

  beforeEach(() => {
    const temp = createTempStorageRoot('gpt-runner-upload-');
    tempRoot = temp.tempRoot;
    storageRoot = temp.storageRoot;
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test('stores uploads as input.png inside the local storage workspace', async () => {
    const logsStore = createLogsStoreMock();

    const service = createJobsService(logsStore, storageRoot, noopScheduler);
    const { _id } = await service.createJob(createJobSpec(), TEST_AVAILABLE_JOB_ID);

    const response = await service.uploadFile(_id, {}, [
      {
        originalname: '../report.txt',
        buffer: Buffer.from('hello world'),
      } as Express.Multer.File,
    ]);

    const storedFile = path.join(storageRoot, _id, 'workspace', 'input.png');

    assert.equal(response.filename, 'input.png');
    assert.equal(response.path_inside_container, '/workspace/input.png');
    assert.equal(readFileSync(storedFile, 'utf8'), 'hello world');
  });

  test('stores ChatGPT file references as input.png', async () => {
    const logsStore = createLogsStoreMock();

    const fileFetch = (async (url: string) => {
      assert.equal(url, 'https://files.example.test/input.png');
      return new Response('downloaded input', {
        status: 200,
        headers: { 'content-length': '16' },
      });
    }) as typeof fetch;

    const service = createJobsService(logsStore, storageRoot, noopScheduler, fileFetch);
    const { _id } = await service.createJob(createJobSpec(), TEST_AVAILABLE_JOB_ID);

    const response = await service.uploadFile(_id, {
      openaiFileIdRefs: ['https://files.example.test/input.png'],
      filename: '../ignored-name.png',
    });

    const storedFile = path.join(storageRoot, _id, 'workspace', 'input.png');

    assert.equal(response.filename, 'input.png');
    assert.equal(response.path_inside_container, '/workspace/input.png');
    assert.equal(readFileSync(storedFile, 'utf8'), 'downloaded input');
  });

  test('stores ChatGPT file reference objects as input.png', async () => {
    const logsStore = createLogsStoreMock();

    const fileFetch = (async (url: string) => {
      assert.equal(url, 'https://files.example.test/object-input.png');
      return new Response('downloaded object input', {
        status: 200,
        headers: { 'content-length': '23' },
      });
    }) as typeof fetch;

    const service = createJobsService(logsStore, storageRoot, noopScheduler, fileFetch);
    const { _id } = await service.createJob(createJobSpec(), TEST_AVAILABLE_JOB_ID);

    const response = await service.uploadFile(_id, {
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

    const storedFile = path.join(storageRoot, _id, 'workspace', 'input.png');

    assert.equal(response.filename, 'input.png');
    assert.equal(response.path_inside_container, '/workspace/input.png');
    assert.equal(readFileSync(storedFile, 'utf8'), 'downloaded object input');
  });

  test('stores the simple file string fallback as input.png', async () => {
    const logsStore = createLogsStoreMock();

    const fileFetch = (async (url: string) => {
      assert.equal(url, 'sediment://files/input.png');
      return new Response('fallback input', {
        status: 200,
        headers: { 'content-length': '14' },
      });
    }) as typeof fetch;

    const service = createJobsService(logsStore, storageRoot, noopScheduler, fileFetch);
    const { _id } = await service.createJob(createJobSpec(), TEST_AVAILABLE_JOB_ID);

    const response = await service.uploadFile(_id, {
      file: 'sediment://files/input.png',
      filename: 'source.png',
    });

    const storedFile = path.join(storageRoot, _id, 'workspace', 'input.png');

    assert.equal(response.filename, 'input.png');
    assert.equal(response.path_inside_container, '/workspace/input.png');
    assert.equal(readFileSync(storedFile, 'utf8'), 'fallback input');
  });

  test('rejects missing and multiple file inputs', async () => {
    const logsStore = createLogsStoreMock();

    const service = createJobsService(logsStore, storageRoot, noopScheduler);
    const { _id } = await service.createJob(createJobSpec(), TEST_AVAILABLE_JOB_ID);

    await assert.rejects(() => service.uploadFile(_id, {}, []), BadRequestException);

    await assert.rejects(
      () =>
        service.uploadFile(
          _id,
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
    const logsStore = createLogsStoreMock();

    const failedFetch = (async () => new Response('missing', { status: 404 })) as typeof fetch;
    const failedService = createJobsService(logsStore, storageRoot, noopScheduler, failedFetch);
    const failedJob = await failedService.createJob(createJobSpec(), TEST_AVAILABLE_JOB_ID);

    await assert.rejects(
      () =>
        failedService.uploadFile(failedJob._id, {
          openaiFileIdRefs: ['https://files.example.test/missing.png'],
        }),
      BadRequestException,
    );

    const oversizedFetch = (async () =>
      new Response('too big', {
        status: 200,
        headers: { 'content-length': String(51 * 1024 * 1024) },
      })) as typeof fetch;
    const oversizedService = createJobsService(logsStore, storageRoot, noopScheduler, oversizedFetch);
    const oversizedJob = await oversizedService.createJob(createJobSpec(), TEST_AVAILABLE_JOB_ID);

    await assert.rejects(
      () =>
        oversizedService.uploadFile(oversizedJob._id, {
          openaiFileIdRefs: ['https://files.example.test/large.png'],
        }),
      BadRequestException,
    );
  });

  test('rejects uploads while the job is running', async () => {
    const logsStore = createLogsStoreMock();

    const service = createJobsService(logsStore, storageRoot, noopScheduler);
    const { _id } = await service.createJob(createJobSpec(), TEST_AVAILABLE_JOB_ID);
    await service.startJob(_id, {});

    await assert.rejects(
      () =>
        service.uploadFile(_id, {}, [
          {
            originalname: 'input.png',
            buffer: Buffer.from('upload'),
          } as Express.Multer.File,
        ]),
      ConflictException,
    );
  });
});
