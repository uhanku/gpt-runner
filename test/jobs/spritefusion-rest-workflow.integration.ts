import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { JobLogsStore } from '../../src/jobs/job-logs.store';

interface JobEnvelope {
  job_id: string;
  status: 'queued' | 'running' | 'success' | 'failed' | 'timeout' | 'deleted';
  status_url: string;
  artifacts_url: string;
}

interface JobStatus {
  job_id: string;
  status: 'queued' | 'running' | 'success' | 'failed' | 'timeout' | 'deleted';
  return_code: number | null;
  logs_tail?: string;
}

interface ArtifactList {
  job_id: string;
  artifacts: Array<{
    name: string;
    size_bytes: number;
    download_url: string;
  }>;
}

const fixturePath = path.resolve(
  __dirname,
  '..',
  '..',
  'storage',
  'images',
  'cat-icon-gpt.png',
);

describe('SpriteFusion Pixel Snapper REST workflow', () => {
  let app: INestApplication | undefined;
  let tempRoot: string;
  let previousCwd: string;
  let previousActionApiKey: string | undefined;
  let previousPublicArtifactSecret: string | undefined;
  let previousPublicBaseUrl: string | undefined;
  let previousRunnerImage: string | undefined;
  let baseUrl: string;
  let jobId: string | undefined;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'gpt-runner-spritefusion-'));
    previousCwd = process.cwd();
    previousActionApiKey = process.env.ACTION_API_KEY;
    previousPublicArtifactSecret = process.env.PUBLIC_ARTIFACT_SECRET;
    previousPublicBaseUrl = process.env.PUBLIC_BASE_URL;
    previousRunnerImage = process.env.RUNNER_IMAGE;

    process.env.ACTION_API_KEY = 'spritefusion-rest-workflow-key';
    process.env.PUBLIC_ARTIFACT_SECRET = 'spritefusion-rest-workflow-secret';
    process.env.RUNNER_IMAGE = process.env.RUNNER_IMAGE || 'gpt-runner:bookworm';
    delete process.env.PUBLIC_BASE_URL;
    process.chdir(tempRoot);
  });

  afterEach(async () => {
    if (app && jobId) {
      try {
        await fetch(`${baseUrl}/jobs/${jobId}`, {
          method: 'DELETE',
          headers: authHeaders(),
        });
      } catch {
        // Best-effort cleanup; temp storage is removed below.
      }
    }

    if (app) {
      await app.close();
      app = undefined;
    }

    process.chdir(previousCwd);
    restoreEnv('ACTION_API_KEY', previousActionApiKey);
    restoreEnv('PUBLIC_ARTIFACT_SECRET', previousPublicArtifactSecret);
    restoreEnv('PUBLIC_BASE_URL', previousPublicBaseUrl);
    restoreEnv('RUNNER_IMAGE', previousRunnerImage);
    rmSync(tempRoot, { recursive: true, force: true });
    jobId = undefined;
  });

  test('creates a job, uploads the input image, runs SpriteFusion, and returns a public PNG download URL', async (t) => {
    const unavailable = dockerUnavailableReason();
    if (unavailable) {
      t.skip(unavailable);
      return;
    }

    const appUnavailable = await startTestApp();
    if (appUnavailable) {
      t.skip(appUnavailable);
      return;
    }

    const created = await requestJson<JobEnvelope>(`${baseUrl}/jobs`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'content-type': 'application/json',
      },
      body: '{}',
    });

    jobId = created.job_id;
    assert.match(created.job_id, /^[0-9a-f-]{36}$/i);
    assert.equal(created.status, 'queued');
    assert.equal(created.status_url, `${baseUrl}/jobs/${created.job_id}`);
    assert.equal(
      created.artifacts_url,
      `${baseUrl}/jobs/${created.job_id}/artifacts`,
    );

    const uploadForm = new FormData();
    uploadForm.set(
      'file',
      new Blob([readFileSync(fixturePath)], { type: 'image/png' }),
      'cat-icon-gpt.png',
    );

    const uploaded = await requestJson<{
      job_id: string;
      filename: string;
      path_inside_container: string;
    }>(`${baseUrl}/jobs/${created.job_id}/files`, {
      method: 'POST',
      headers: authHeaders(),
      body: uploadForm,
    });

    assert.equal(uploaded.job_id, created.job_id);
    assert.equal(uploaded.filename, 'input.png');
    assert.equal(uploaded.path_inside_container, '/workspace/input.png');

    const started = await requestJson<JobEnvelope>(
      `${baseUrl}/jobs/${created.job_id}/start`,
      {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          repo_url: 'https://github.com/Hugo-Dz/spritefusion-pixel-snapper.git',
          commands: [
            'export RUSTUP_INIT_SKIP_PATH_CHECK=yes',
            'curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal',
            '. "$HOME/.cargo/env"',
            'cargo run --release -- ../input.png /artifacts/cat-icon-gpt-snapped.png 16',
          ],
          timeout_seconds: 900,
          network: 'on',
        }),
      },
    );

    assert.equal(started.job_id, created.job_id);
    assert.equal(started.status, 'running');

    const finalStatus = await waitForTerminalStatus(
      `${baseUrl}/jobs/${created.job_id}`,
    );
    assert.equal(
      finalStatus.status,
      'success',
      `expected SpriteFusion job to succeed; logs tail:\n${finalStatus.logs_tail ?? ''}`,
    );
    assert.equal(finalStatus.return_code, 0);

    const artifactList = await requestJson<ArtifactList>(
      `${baseUrl}/jobs/${created.job_id}/artifacts`,
      {
        headers: authHeaders(),
      },
    );

    const output = artifactList.artifacts.find(
      (artifact) => artifact.name === 'cat-icon-gpt-snapped.png',
    );
    assert.ok(
      output,
      `expected cat-icon-gpt-snapped.png artifact, got ${JSON.stringify(
        artifactList.artifacts,
      )}`,
    );
    assert.ok(output.size_bytes > 0);

    const downloadUrl = new URL(output.download_url);
    assert.equal(
      downloadUrl.origin + downloadUrl.pathname,
      `${baseUrl}/jobs/${created.job_id}/artifact`,
    );
    assert.equal(
      downloadUrl.searchParams.get('path'),
      'cat-icon-gpt-snapped.png',
    );
    assert.match(downloadUrl.searchParams.get('signature') ?? '', /^[0-9a-f]{64}$/);

    const download = await fetch(output.download_url);
    assert.equal(download.status, 200);
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  });

  async function startTestApp() {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(JobLogsStore)
      .useValue(createInMemoryLogsStore())
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );

    try {
      await app.listen(0, '127.0.0.1');
    } catch (error) {
      await app.close();
      app = undefined;

      if (error instanceof Error && 'code' in error && error.code === 'EPERM') {
        return 'Local HTTP listeners are unavailable in this environment.';
      }

      throw error;
    }

    baseUrl = await app.getUrl();
    return '';
  }
});

function authHeaders() {
  return {
    authorization: `Bearer ${process.env.ACTION_API_KEY}`,
  };
}

function createInMemoryLogsStore() {
  const logs = new Map<string, string[]>();

  return {
    append: async (jobId: string, text: string) => {
      logs.set(jobId, [...(logs.get(jobId) ?? []), text]);
    },
    tail: async (jobId: string, maxBytes: number) => {
      const text = (logs.get(jobId) ?? []).join('');
      const buffer = Buffer.from(text, 'utf8');
      return buffer.length > maxBytes
        ? buffer.subarray(buffer.length - maxBytes).toString('utf8')
        : text;
    },
    deleteByJobId: async (jobId: string) => {
      logs.delete(jobId);
    },
    recent: async () => [],
    onModuleInit: async () => undefined,
    onModuleDestroy: async () => undefined,
  } as unknown as JobLogsStore;
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Request failed: ${init.method ?? 'GET'} ${url} ${response.status} ${text}`,
    );
  }

  return JSON.parse(text) as T;
}

async function waitForTerminalStatus(url: string): Promise<JobStatus> {
  const deadline = Date.now() + 900_000;
  let lastStatus: JobStatus | undefined;

  while (Date.now() < deadline) {
    lastStatus = await requestJson<JobStatus>(url, {
      headers: authHeaders(),
    });

    if (
      lastStatus.status === 'success' ||
      lastStatus.status === 'failed' ||
      lastStatus.status === 'timeout'
    ) {
      return lastStatus;
    }

    await delay(2_000);
  }

  throw new Error(
    `Timed out waiting for SpriteFusion job; last status: ${JSON.stringify(
      lastStatus,
    )}`,
  );
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dockerUnavailableReason() {
  try {
    execFileSync('docker', ['version'], { stdio: 'ignore' });
  } catch {
    return 'Docker is unavailable; start Docker before running the SpriteFusion workflow test.';
  }

  try {
    execFileSync('docker', ['image', 'inspect', process.env.RUNNER_IMAGE || ''], {
      stdio: 'ignore',
    });
  } catch {
    return `Runner image ${process.env.RUNNER_IMAGE} is missing; build it with: docker build -t gpt-runner:bookworm ./runner`;
  }

  return '';
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
