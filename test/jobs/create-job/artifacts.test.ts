import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RunJobCommandsDto } from '../../../src/jobs/dto/create-job.dto';
import {
  createJobSpec,
  createJobsService,
  createLogsStoreMock,
  createTempStorageRoot,
  noopScheduler,
  TEST_AVAILABLE_JOB_ID,
} from './shared';

describe('JobsService.listArtifacts', () => {
  let tempRoot: string;
  let storageRoot: string;
  let previousPublicArtifactSecret: string | undefined;

  beforeEach(() => {
    previousPublicArtifactSecret = process.env.PUBLIC_ARTIFACT_SECRET;
    process.env.PUBLIC_ARTIFACT_SECRET = 'test-public-artifact-secret';
    const temp = createTempStorageRoot('gpt-runner-artifacts-');
    tempRoot = temp.tempRoot;
    storageRoot = temp.storageRoot;
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
    const logsStore = createLogsStoreMock();

    const service = createJobsService(logsStore, storageRoot, noopScheduler);
    const { job_id } = await service.createJob(createJobSpec(), TEST_AVAILABLE_JOB_ID);

    const artifactsDir = path.join(storageRoot, job_id, 'artifacts');
    mkdirSync(path.join(artifactsDir, 'nested'), { recursive: true });
    writeFileSync(path.join(artifactsDir, 'nested', 'report one.txt'), 'download me', 'utf8');

    const response = await service.listArtifacts(job_id, 'https://api.example.test/');

    assert.equal(response.job_id, job_id);
    assert.equal(response.artifacts.length, 1);
    assert.equal(response.artifacts[0].name, 'nested/report one.txt');
    assert.equal(response.artifacts[0].size_bytes, 11);

    const downloadUrl = new URL(response.artifacts[0].download_url);
    assert.equal(downloadUrl.origin + downloadUrl.pathname, `https://api.example.test/jobs/${job_id}/artifact`);
    assert.equal(downloadUrl.searchParams.get('path'), 'nested/report one.txt');
    assert.match(downloadUrl.searchParams.get('signature') || '', /^[0-9a-f]{64}$/);

    const file = await service.getArtifactFile(
      job_id,
      'nested/report one.txt',
      downloadUrl.searchParams.get('signature') || '',
    );
    assert.equal(file.absolutePath, path.join(artifactsDir, 'nested', 'report one.txt'));
  });

  test('uses PUBLIC_BASE_URL before the request origin for artifact URLs', async () => {
    const previousPublicBaseUrl = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = 'https://public.example.test/';

    try {
      const logsStore = createLogsStoreMock();

      const service = createJobsService(logsStore, storageRoot, noopScheduler);
      const { job_id } = await service.createJob(createJobSpec(), TEST_AVAILABLE_JOB_ID);

      const artifactsDir = path.join(storageRoot, job_id, 'artifacts');
      writeFileSync(path.join(artifactsDir, 'report.txt'), 'ok', 'utf8');

      const response = await service.listArtifacts(job_id, 'https://request.example.test');

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
    const logsStore = createLogsStoreMock();

    const dto: RunJobCommandsDto = {
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
    const script = (
      service as unknown as {
        commandsScript(dto: RunJobCommandsDto): string;
      }
    ).commandsScript(dto);

    assert.match(script, /convert .*mixed-pixel-art\.png/);
    assert.match(
      script,
      /cargo run --release -- mixed-pixel-art\.png \/artifacts\/spritefusion-pixel-snapped\.png 4 --pixel-size 8/,
    );

    const { job_id } = await service.createJob(createJobSpec(), TEST_AVAILABLE_JOB_ID);
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
    assert.equal(response.artifacts[0].name, 'spritefusion-pixel-snapped.png');
    assert.equal(response.artifacts[0].size_bytes, statSync(outputImage).size);

    const downloadUrl = new URL(response.artifacts[0].download_url);
    assert.equal(downloadUrl.origin + downloadUrl.pathname, `https://api.example.test/jobs/${job_id}/artifact`);
    assert.equal(downloadUrl.searchParams.get('path'), 'spritefusion-pixel-snapped.png');
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
    const logsStore = createLogsStoreMock();

    const service = createJobsService(logsStore, storageRoot, noopScheduler);
    const { job_id } = await service.createJob(createJobSpec(), TEST_AVAILABLE_JOB_ID);
    const otherJob = await service.createJob(createJobSpec(), TEST_AVAILABLE_JOB_ID);

    const artifactsDir = path.join(storageRoot, job_id, 'artifacts');
    writeFileSync(path.join(artifactsDir, 'report.txt'), 'ok', 'utf8');
    writeFileSync(path.join(artifactsDir, 'other.txt'), 'ok', 'utf8');

    const response = await service.listArtifacts(job_id, 'https://api.example.test');
    const report = response.artifacts.find((artifact) => artifact.name === 'report.txt');
    assert.ok(report);
    const signature = new URL(report.download_url).searchParams.get('signature');
    assert.ok(signature);

    await assert.rejects(() => service.getArtifactFile(job_id, 'report.txt', ''), UnauthorizedException);
    await assert.rejects(() => service.getArtifactFile(job_id, 'report.txt', 'not-hex'), UnauthorizedException);
    await assert.rejects(() => service.getArtifactFile(job_id, 'other.txt', signature), UnauthorizedException);
    await assert.rejects(
      () => service.getArtifactFile(otherJob.job_id, 'report.txt', signature),
      UnauthorizedException,
    );
  });

  test('requires PUBLIC_ARTIFACT_SECRET to generate artifact URLs', async () => {
    delete process.env.PUBLIC_ARTIFACT_SECRET;

    const logsStore = createLogsStoreMock();

    const service = createJobsService(logsStore, storageRoot, noopScheduler);
    const { job_id } = await service.createJob(createJobSpec(), TEST_AVAILABLE_JOB_ID);

    const artifactsDir = path.join(storageRoot, job_id, 'artifacts');
    writeFileSync(path.join(artifactsDir, 'report.txt'), 'ok', 'utf8');

    await assert.rejects(() => service.listArtifacts(job_id, 'https://api.example.test'), InternalServerErrorException);
  });
});
