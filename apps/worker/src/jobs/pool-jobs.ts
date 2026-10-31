import {
  workerPoolsRepo,
  type AppDb,
  type PoolContext,
  type PoolRunner,
  type PoolTx,
} from '@nestvault/db';
import { linkDepositsInPool, lisbonDay, remindPlansInPool } from '@nestvault/services';
import { z } from 'zod';

import { forEachPool } from '../pools';

import { defineJob } from './define';

export interface PoolJobDeps {
  /** The worker's connection, for the list of pools (the only query outside a pool). */
  db: Pick<AppDb, 'select'>;
  /** `withPool` as `worker_rw`: every query of a pool runs inside it, under RLS. */
  withPool: PoolRunner;
  now?: () => Date;
}

/** `yyyy-mm-dd` of `now` in the household's time zone (the schedules are read in Europe/Lisbon too). */
export const lisbonToday = lisbonDay;

const PoolPayload = z.object({ poolId: z.uuid().optional() }).strict();

interface PoolJobSpec {
  name: string;
  cron: string;
  dedupeSeconds: number;
  work: (tx: PoolTx, ctx: PoolContext, today: string) => Promise<object>;
  doneMessage: string;
}

/**
 * A job that runs `work` once per pool: the pool named in the payload, or every pool the worker knows
 * (the scheduled sweep). Pools are isolated: one system context and one `withPool` each, and one
 * failing pool does not stop the others. `work` must be idempotent.
 */
function createPoolJob({ db, withPool, now = () => new Date() }: PoolJobDeps, spec: PoolJobSpec) {
  return defineJob({
    name: spec.name,
    payload: PoolPayload,
    schedule: { cron: spec.cron, data: {} },
    // A sweep and a request for the same pool within the window make one run.
    singleton: { key: (payload) => payload.poolId ?? 'all', dedupeSeconds: spec.dedupeSeconds },
    async run(payload, { log }) {
      const today = lisbonToday(now());
      const poolIds = payload.poolId ? [payload.poolId] : await workerPoolsRepo.list(db);
      await forEachPool(poolIds, [], log, async (ctx) => {
        const outcome = await withPool(ctx, (tx) => spec.work(tx, ctx, today));
        log.info({ pool_id: ctx.poolId, ...outcome }, spec.doneMessage);
      });
    },
  });
}

/**
 * `deposits.link`: links the statement lines of a pool to the flows its term deposits expect and
 * records the links. `{ poolId }` is what an import commit asks for; `{}` sweeps every pool hourly,
 * so a statement imported while nobody asked is linked within the hour.
 */
export const createDepositsLinkJob = (deps: PoolJobDeps) =>
  createPoolJob(deps, {
    name: 'deposits.link',
    cron: '20 * * * *',
    dedupeSeconds: 60,
    work: linkDepositsInPool,
    doneMessage: 'deposit flows linked',
  });

/**
 * `plans.remind`: every day at 09:00, a notification for each active plan whose day of the month
 * has passed without a buy for the month. Once per plan and month; resolved when the buy is
 * registered.
 */
export const createPlansRemindJob = (deps: PoolJobDeps) =>
  createPoolJob(deps, {
    name: 'plans.remind',
    cron: '0 9 * * *',
    dedupeSeconds: 3600,
    work: remindPlansInPool,
    doneMessage: 'plan reminders updated',
  });
