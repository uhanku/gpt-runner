import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { AVAILABLE_JOB_SEEDS, seedAvailableJobs } from '../../src/seeds/available-jobs.seed';

describe('seedAvailableJobs', () => {
  test('upserts the spritefusion runner image seed', async () => {
    const calls: Array<{
      name: string;
      goal: string;
    }> = [];
    let initCalled = false;
    let destroyCalled = false;

    await seedAvailableJobs({
      onModuleInit: async () => {
        initCalled = true;
      },
      onModuleDestroy: async () => {
        destroyCalled = true;
      },
      upsert: async (image) => {
        calls.push(image);
      },
    });

    assert.equal(initCalled, true);
    assert.equal(destroyCalled, true);
    assert.deepEqual(calls, AVAILABLE_JOB_SEEDS);
  });
});
