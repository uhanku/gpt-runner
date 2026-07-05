import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { AVAILABLE_DOCKER_IMAGE_SEEDS, seedAvailableDockerImages } from '../../src/seeds/available-docker-images.seed';

describe('seedAvailableDockerImages', () => {
  test('upserts the spritefusion runner image seed', async () => {
    const calls: Array<{
      name: string;
      goal: string;
    }> = [];
    let initCalled = false;
    let destroyCalled = false;

    await seedAvailableDockerImages({
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
    assert.deepEqual(calls, AVAILABLE_DOCKER_IMAGE_SEEDS);
  });
});
