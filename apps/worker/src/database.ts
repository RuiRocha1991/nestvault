import { createAppDatabase, createWithPool, type PoolRunner } from '@nestvault/db';

/**
 * `withPool` for worker jobs. It connects as `worker_rw` (not `app_rw`), so the same RLS policies
 * apply: every query runs inside a transaction scoped to one pool. Created on first use.
 */
export function createWorkerPoolRunner(
  connectionString: string,
): PoolRunner & { close(): Promise<void> } {
  let database: ReturnType<typeof createAppDatabase> | undefined;
  const run = createWithPool(() => (database ??= createAppDatabase(connectionString, 4)));
  // Closes the connections if the runner was ever used; the worker calls it on shutdown.
  return Object.assign(run, { close: async () => database?.close() });
}
