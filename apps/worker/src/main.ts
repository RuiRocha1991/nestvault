import { workerEnv } from '@nestvault/config/node';
import { createAppDatabase } from '@nestvault/db';
import { createLogger } from '@nestvault/services';

import { createWorkerPoolRunner } from './database';
import { createProductionJobs } from './jobs/registry';
import { samplePing } from './jobs/sample';
import { createWorker } from './runtime';

const log = createLogger();
const env = workerEnv();

// The sample job only runs outside production, to see the runtime working.
// Jobs about global data (no pool) write through the worker's own connection.
const database = createAppDatabase(env.DATABASE_URL_WORKER, 2);
const withPool = createWorkerPoolRunner(env.DATABASE_URL_WORKER);
const production = createProductionJobs({ db: database.db, withPool });
const jobs = env.NODE_ENV === 'production' ? production : [...production, samplePing];
const worker = createWorker({ connectionString: env.DATABASE_URL_WORKER, jobs, log });

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, 'shutting down');
  try {
    await worker.stop();
    await database.close();
    await withPool.close();
    process.exit(0);
  } catch (error) {
    log.error({ err: error }, 'shutdown failed');
    process.exit(1);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await worker.start();
} catch (error) {
  // Never print the connection string or the driver message (it may carry credentials).
  const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown';
  log.error(
    { code },
    'worker could not start. Is the database up and migrated? Try: pnpm db:up && pnpm db:migrate',
  );
  process.exit(1);
}
