import 'reflect-metadata';
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import mongoose from 'mongoose';
import { AvailableJobsStore } from '../../src/jobs/storage/available-jobs.store';

function createModel() {
  const state = {
    initCalled: false,
    updates: [] as Array<{
      filter: { name: string };
      update: { $set: { name: string; goal: string } };
      options: { upsert: true };
    }>,
  };

  return {
    state,
    updateOne: async (
      filter: { name: string },
      update: { $set: { name: string; goal: string } },
      options: { upsert: true },
    ) => {
      state.updates.push({ filter, update, options });
      return { acknowledged: true };
    },
    init: async () => {
      state.initCalled = true;
    },
  };
}

describe('AvailableJobsStore', () => {
  const mongooseAny = mongoose as any;
  const originalCreateConnection = mongooseAny.createConnection as typeof mongoose.createConnection;

  afterEach(() => {
    mongooseAny.createConnection = originalCreateConnection;
  });

  test('initializes a mongoose connection and model with the configured collection', async () => {
    const store = new AvailableJobsStore();
    const model = createModel();
    const connection = {
      asPromise: async () => connection,
      model: () => model,
      close: async () => {},
    };

    let receivedUri: string | undefined;
    let receivedOptions: Record<string, unknown> | undefined;

    mongooseAny.createConnection = ((uri: string, options: any) => {
      receivedUri = uri;
      receivedOptions = options;
      return connection as never;
    }) as unknown as typeof mongoose.createConnection;

    await store.onModuleInit();

    assert.equal(receivedUri, 'mongodb://127.0.0.1:27017');
    assert.deepEqual(receivedOptions, {
      dbName: 'gpt_runner',
      serverSelectionTimeoutMS: 5000,
    });
    assert.equal(model.state.initCalled, true);

    await store.onModuleDestroy();
  });

  test('upsert writes the available image document by name', async () => {
    const model = createModel();
    const store = new AvailableJobsStore();
    (store as unknown as { jobModel: typeof model }).jobModel = model;

    await store.upsert({
      name: 'gpt-runner:spritefusion',
      goal: 'remove pixel art mixels from ai and scale that image',
    });

    assert.deepEqual(model.state.updates, [
      {
        filter: { name: 'gpt-runner:spritefusion' },
        update: {
          $set: {
            name: 'gpt-runner:spritefusion',
            goal: 'remove pixel art mixels from ai and scale that image',
          },
        },
        options: { upsert: true },
      },
    ]);
  });
});
