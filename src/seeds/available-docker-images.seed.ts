import 'dotenv/config';
import { AvailableDockerImagesStore } from '../jobs/storage/available-docker-images.store';
import type { AvailableDockerImageDocument } from '../jobs/schemas/available-docker-image.schema';

export const AVAILABLE_DOCKER_IMAGE_SEEDS: AvailableDockerImageDocument[] = [
  {
    name: 'images/Dockerfile.spritefusion',
    goal: 'remove pixel art mixels from ai and scale that image',
  },
];

export interface AvailableDockerImagesSeedStore {
  onModuleInit(): Promise<void>;
  onModuleDestroy(): Promise<void>;
  upsert(image: AvailableDockerImageDocument): Promise<void>;
}

export async function seedAvailableDockerImages(
  store: AvailableDockerImagesSeedStore = new AvailableDockerImagesStore(),
) {
  await store.onModuleInit();

  try {
    for (const image of AVAILABLE_DOCKER_IMAGE_SEEDS) {
      await store.upsert(image);
    }
  } finally {
    await store.onModuleDestroy();
  }
}

async function main() {
  await seedAvailableDockerImages();
}

if (require.main === module) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[gpt-runner] available image seed failed: ${message}\n`);
    process.exitCode = 1;
  });
}
