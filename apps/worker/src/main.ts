import { workerEnv } from '@nestvault/config/node';
import { createLogger } from '@nestvault/services';

import { PRODUCTION_JOBS } from './jobs/registry';
import { samplePing } from './jobs/sample';
import { createWorker } from './runtime';

const log = createLogger();
const env = workerEnv();

// The sample job only runs outside production, to see the runtime working.
const jobs = env.NODE_ENV === 'production' ? PRODUCTION_JOBS : [...PRODUCTION_JOBS, samplePing];
const worker = createWorker({ connectionString: env.DATABASE_URL_WORKER, jobs, log });

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, 'shutting down');
  try {
    await worker.stop();
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
