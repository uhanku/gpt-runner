import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { JobsController } from '../../../src/jobs/jobs.controller';

describe('Swagger docs', () => {
  test('documents the create-job request body fields', async () => {
    const metadata = Reflect.getMetadata('swagger/apiParameters', JobsController.prototype.createJob) as Array<{
      in?: string;
      schema?: { required?: string[]; properties?: Record<string, unknown> };
    }>;

    const bodyMetadata = metadata?.find((entry) => entry.in === 'body');

    assert.ok(bodyMetadata);
    assert.deepEqual(bodyMetadata?.schema?.required, ['goal', 'available_job_id']);
    assert.ok(bodyMetadata?.schema?.properties?.available_job_id);
  });

  test('documents the bootstrap start-job request body example', async () => {
    const metadata = Reflect.getMetadata('swagger/apiParameters', JobsController.prototype.startJob) as Array<{
      in?: string;
      schema?: { example?: unknown };
    }>;

    const bodyMetadata = metadata?.find((entry) => entry.in === 'body');

    assert.ok(bodyMetadata);
    assert.deepEqual(bodyMetadata?.schema?.example, {
      repo_url: 'https://github.com/pallets/flask.git',
      branch: 'main',
    });
  });

  test('documents the commands execution request body example', async () => {
    const metadata = Reflect.getMetadata('swagger/apiParameters', JobsController.prototype.runCommands) as Array<{
      in?: string;
      schema?: { example?: unknown };
    }>;

    const bodyMetadata = metadata?.find((entry) => entry.in === 'body');

    assert.ok(bodyMetadata);
    assert.deepEqual(bodyMetadata?.schema?.example, {
      commands: ['ls -la', 'pytest'],
    });
  });

  test('documents the queued jobs list route', async () => {
    const metadata = Reflect.getMetadata('swagger/apiResponse', JobsController.prototype.listQueuedJobs) as Record<
      string,
      { schema?: { type?: string; items?: { properties?: Record<string, unknown> } } }
    >;

    const okResponse = metadata['200'];

    assert.ok(okResponse);
    assert.equal(okResponse.schema?.type, 'array');
    assert.equal((okResponse.schema?.items?.properties?.status as { type?: string } | undefined)?.type, 'string');
    assert.deepEqual((okResponse.schema?.items?.properties?.status as { enum?: string[] } | undefined)?.enum, [
      'queued',
      'running',
      'success',
      'failed',
      'timeout',
      'deleted',
    ]);
    assert.deepEqual(Reflect.getMetadata('path', JobsController.prototype.listQueuedJobs), 'queued');
  });
});
