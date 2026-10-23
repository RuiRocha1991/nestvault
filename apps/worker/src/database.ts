import { createAppDatabase, createWithPool, type PoolRunner } from '@nestvault/db';

/**
 * `withPool` for worker jobs. It connects as `worker_rw` (not `app_rw`), so the same RLS policies
 * apply: every query runs inside a transaction scoped to one pool. Created on first use.
 */
export function createWorkerPoolRunner(connectionString: string): PoolRunner {
  let database: ReturnType<typeof createAppDatabase> | undefined;
  return createWithPool(() => (database ??= createAppDatabase(connectionString, 4)));
}
