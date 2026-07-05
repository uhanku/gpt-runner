import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { AvailableJobsController } from '../../src/jobs/available-jobs.controller';

describe('AvailableJobsController', () => {
  test('lists available jobs through the REST endpoint', async () => {
    const controller = new AvailableJobsController({
      listJobs: async () => [
        {
          id: '507f1f77bcf86cd799439011',
          name: 'gpt-runner:test-image',
          goal: 'Run the repository test suite.',
        },
      ],
      getJob: async () => {
        throw new Error('unused');
      },
    } as never);

    const jobs = await controller.listAvailableJobs();

    assert.deepEqual(jobs, [
      {
        id: '507f1f77bcf86cd799439011',
        name: 'gpt-runner:test-image',
        goal: 'Run the repository test suite.',
      },
    ]);
  });

  test('documents the route response shape', async () => {
    const metadata = Reflect.getMetadata('swagger/apiResponse', AvailableJobsController.prototype.listAvailableJobs) as Record<
      string,
      { schema?: { type?: string; items?: { properties?: Record<string, unknown> } } }
    >;

    const okResponse = metadata['200'];

    assert.ok(okResponse);
    assert.equal(okResponse.schema?.type, 'array');
    assert.deepEqual(Object.keys(okResponse.schema?.items?.properties ?? {}), ['id', 'name', 'goal']);
  });
});
