import { isAbsolute, resolve } from 'node:path';

import { workerEnv } from '@nestvault/config/node';
import { createAppDatabase, createIdentityDatabase } from '@nestvault/db';
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
const identity = createIdentityDatabase(env.DATABASE_URL_IDENTITY, 2);
// A relative IMPORT_STORAGE_DIR is from the repository root (two levels above apps/worker).
const storageDir = isAbsolute(env.IMPORT_STORAGE_DIR)
  ? env.IMPORT_STORAGE_DIR
  : resolve(import.meta.dirname, '../../..', env.IMPORT_STORAGE_DIR);
const production = createProductionJobs({
  db: database.db,
  tenant: { identity, run: createWorkerPoolRunner(env.DATABASE_URL_WORKER), storageDir },
});
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
    await identity.close();
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
