import { poolsRepo } from '@nestvault/db';
import { snapshotPool } from '@nestvault/services';
import { z } from 'zod';

import { forEachPool } from '../pools';

import { defineJob } from './define';
import { lisbonDay, type TenantJobDeps } from './tenant';

/**
 * `snapshots.daily`: at 23:30 stores each pool's net worth of the day (`net_worth_snapshots`),
 * computed by the domain engine. Idempotent (one row per pool and day, replaced on a rerun). One
 * failing pool does not stop the others; the run fails at the end so the queue retries.
 */
export function createSnapshotsDailyJob({ identity, run, now = () => new Date() }: TenantJobDeps) {
  return defineJob({
    name: 'snapshots.daily',
    payload: z.object({}).strict(),
    schedule: { cron: '30 23 * * *', data: {} },
    singleton: { key: () => 'snapshots', dedupeSeconds: 3600 },
    async run(_payload, { log }) {
      const today = lisbonDay(now());
      const poolIds = await poolsRepo.listIds(identity.db);
      await forEachPool(poolIds, ['pool.read', 'snapshots.write'], log, async (ctx) => {
        await snapshotPool(ctx, { today }, run);
      });
    },
  });
}
