import 'dotenv/config';
import { AvailableJobsStore } from '../jobs/storage/available-jobs.store';
import type { AvailableJobDocument } from '../jobs/schemas/available-job.schema';

export const AVAILABLE_JOB_SEEDS: AvailableJobDocument[] = [
  {
    name: 'images/Dockerfile.spritefusion',
    goal: 'remove pixel art mixels from ai and scale that image',
  },
];

export interface AvailableJobsSeedStore {
  onModuleInit(): Promise<void>;
  onModuleDestroy(): Promise<void>;
  upsert(job: AvailableJobDocument): Promise<void>;
}

export async function seedAvailableJobs(store: AvailableJobsSeedStore = new AvailableJobsStore()) {
  await store.onModuleInit();

  try {
    for (const job of AVAILABLE_JOB_SEEDS) {
      await store.upsert(job);
    }
  } finally {
    await store.onModuleDestroy();
  }
}

async function main() {
  await seedAvailableJobs();
}

if (require.main === module) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[gpt-runner] available job seed failed: ${message}\n`);
    process.exitCode = 1;
  });
}
