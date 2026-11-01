import { workerPoolsRepo, type AppDb } from '@nestvault/db';
import { z } from 'zod';

import { defineJob } from './define';

export interface PoolsReconcileJobDeps {
  /** The worker's connection: the only call is `reconcile_worker_pools()`. */
  db: Pick<AppDb, 'execute'>;
}

/**
 * `pools.reconcile` (NES-150): makes `worker_pools`, the list the per-pool sweeps visit, match the
 * pools that really have accounts. The trigger on `accounts` covers normal inserts; this catches the
 * pools that got their data some other way (a restore, a bulk load with triggers off) and drops the
 * ones with no data left, so no sweep keeps visiting a deleted pool. Global and idempotent. Daily
 * at 03:40, and once when the worker starts.
 */
export function createPoolsReconcileJob({ db }: PoolsReconcileJobDeps) {
  return defineJob({
    name: 'pools.reconcile',
    payload: z.object({}).strict(),
    schedule: { cron: '40 3 * * *', data: {} },
    singleton: { key: () => 'pools', dedupeSeconds: 600 },
    async run(_payload, { log }) {
      const { added, removed } = await workerPoolsRepo.reconcile(db);
      log.info({ added, removed }, 'worker pools reconciled');
    },
  });
}
