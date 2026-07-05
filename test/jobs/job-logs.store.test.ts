import 'reflect-metadata';
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import mongoose from 'mongoose';
import { JobLogsStore } from '../../src/jobs/shared/job-logs.store';

type LogEntry = {
  jobId: string;
  text: string;
  created_at: Date;
};

function createCursor(entries: LogEntry[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const entry of entries) {
        yield entry;
      }
    },
  };
}

function createQuery(entries: LogEntry[]) {
  let limit = entries.length;

  return {
    sort() {
      return this;
    },
    limit(nextLimit: number) {
      limit = nextLimit;
      return this;
    },
    cursor() {
      const ordered = [...entries].sort((left, right) => right.created_at.getTime() - left.created_at.getTime());
      return createCursor(ordered.slice(0, limit));
    },
  };
}

function createModel(entries: LogEntry[] = []) {
  const state = {
    entries,
    created: [] as Array<{ jobId: string; text: string; created_at: Date }>,
    deleted: [] as Array<{ jobId: string }>,
    initCalled: false,
  };

  return {
    state,
    create: async (entry: { jobId: string; text: string; created_at: Date }) => {
      state.created.push(entry);
      state.entries.push(entry);
      return entry;
    },
    deleteMany: async (filter: { jobId: string }) => {
      state.deleted.push(filter);
      state.entries = state.entries.filter((entry) => entry.jobId !== filter.jobId);
      return { acknowledged: true };
    },
    find: (filter: { jobId?: string }) => {
      const filtered = filter.jobId
        ? state.entries.filter((entry) => entry.jobId === filter.jobId)
        : [...state.entries];
      return createQuery(filtered);
    },
    init: async () => {
      state.initCalled = true;
    },
  };
}

describe('JobLogsStore', () => {
  const mongooseAny = mongoose as any;
  const originalCreateConnection = mongooseAny.createConnection as typeof mongoose.createConnection;

  afterEach(() => {
    mongooseAny.createConnection = originalCreateConnection;
  });

  test('initializes a mongoose connection and model with the configured collection', async () => {
    const store = new JobLogsStore();
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

  test('rejects startup when the connection cannot be established', async () => {
    const store = new JobLogsStore();

    mongooseAny.createConnection = (() => ({
      asPromise: async () => {
        throw new Error('mongo is down');
      },
    })) as unknown as typeof mongoose.createConnection;

    await assert.rejects(() => store.onModuleInit(), /mongo is down/);
  });

  test('append stores non-empty log lines', async () => {
    const model = createModel();
    const store = new JobLogsStore();
    (store as unknown as { logModel: typeof model }).logModel = model;

    await store.append('job-1', 'hello');
    await store.append('job-1', '');

    assert.equal(model.state.created.length, 1);
    assert.deepEqual(model.state.created[0]?.jobId, 'job-1');
    assert.deepEqual(model.state.created[0]?.text, 'hello');
    assert.ok(model.state.created[0]?.created_at instanceof Date);
  });

  test('tail returns the newest bytes first within the limit', async () => {
    const model = createModel([
      {
        jobId: 'job-1',
        text: 'abc',
        created_at: new Date('2024-01-01T00:00:00.000Z'),
      },
      {
        jobId: 'job-1',
        text: 'def',
        created_at: new Date('2024-01-01T00:01:00.000Z'),
      },
      {
        jobId: 'job-1',
        text: 'ghi',
        created_at: new Date('2024-01-01T00:02:00.000Z'),
      },
    ]);
    const store = new JobLogsStore();
    (store as unknown as { logModel: typeof model }).logModel = model;

    assert.equal(await store.tail('job-1', 5), 'efghi');
    assert.equal(await store.tail('job-1', 0), '');
  });

  test('recent returns the newest entries in descending order', async () => {
    const model = createModel([
      {
        jobId: 'job-2',
        text: 'latest',
        created_at: new Date('2024-01-01T00:02:00.000Z'),
      },
      {
        jobId: 'job-1',
        text: 'middle',
        created_at: new Date('2024-01-01T00:01:00.000Z'),
      },
      {
        jobId: 'job-3',
        text: 'oldest',
        created_at: new Date('2024-01-01T00:00:00.000Z'),
      },
    ]);
    const store = new JobLogsStore();
    (store as unknown as { logModel: typeof model }).logModel = model;

    assert.deepEqual(await store.recent(2), [
      {
        jobId: 'job-2',
        text: 'latest',
        created_at: '2024-01-01T00:02:00.000Z',
      },
      {
        jobId: 'job-1',
        text: 'middle',
        created_at: '2024-01-01T00:01:00.000Z',
      },
    ]);
    assert.deepEqual(await store.recent(0), []);
  });

  test('deleteByJobId removes all logs for the requested job', async () => {
    const model = createModel([
      {
        jobId: 'job-1',
        text: 'keep-me',
        created_at: new Date('2024-01-01T00:01:00.000Z'),
      },
      {
        jobId: 'job-2',
        text: 'remove-me',
        created_at: new Date('2024-01-01T00:02:00.000Z'),
      },
    ]);
    const store = new JobLogsStore();
    (store as unknown as { logModel: typeof model }).logModel = model;

    await store.deleteByJobId('job-2');

    assert.deepEqual(model.state.deleted, [{ jobId: 'job-2' }]);
    assert.deepEqual(model.state.entries, [
      {
        jobId: 'job-1',
        text: 'keep-me',
        created_at: new Date('2024-01-01T00:01:00.000Z'),
      },
    ]);
  });
});
