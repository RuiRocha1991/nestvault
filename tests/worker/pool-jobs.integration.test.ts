import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { testEnv } from '@nestvault/config/node';
import {
  accountsRepo,
  assetsRepo,
  createAppDatabase,
  depositsRepo,
  investmentOpsRepo,
  newId,
  notificationsRepo,
  plansRepo,
  portfoliosRepo,
  transactionsRepo,
  workerPoolsRepo,
  type PoolContext,
  type PoolTx,
} from '@nestvault/db';
import { depositSchedule } from '@nestvault/domain';
import { createLogger } from '@nestvault/services';

import { createWorkerPoolRunner } from '../../apps/worker/src/database';
import { createDepositsLinkJob, createPlansRemindJob } from '../../apps/worker/src/jobs/pool-jobs';
import { failureCodeOf, openTestDatabase, createTwoPools } from '../db/harness';

// Every test works in pools of its own (random ids), so it needs no truncate and cannot disturb a
// test running in parallel against the same database.
const database = openTestDatabase(2);
const worker = createAppDatabase(testEnv().TEST_DATABASE_URL_WORKER, 2);
const workerWithPool = createWorkerPoolRunner(testEnv().TEST_DATABASE_URL_WORKER);
const log = createLogger({ level: 'silent' });
const info = (jobName: string) => ({ runId: 'run', jobName, attempt: 1, log });
const TODAY = new Date('2026-06-10T10:00:00Z');

afterAll(async () => {
  await worker.close();
  await database.close();
});

const { withPool } = database;

const account = (tx: PoolTx, ctx: PoolContext, type: string, name: string) =>
  accountsRepo.insert(tx, ctx, newId(), {
    type,
    name,
    institution: null,
    iban: null,
    currency: 'EUR',
    opening: '0',
    openingDate: null,
    trackCash: true,
    groupName: null,
    portfolioId: null,
    rate: null,
    xtbAccountNo: null,
  });

const line = (accountId: string, date: string, amount: string, description: string) => ({
  accountId,
  date,
  description,
  amount,
  categoryId: null,
  transfer: false,
  transferLocked: false,
  manualCategory: false,
  hash: `${description}-${date}`,
});

const DEPOSIT = {
  productId: null,
  capital: '10000',
  start: '2026-01-10',
  rate: '2.5',
  payN: 3,
  payU: 'm' as const,
  termN: 12,
  termU: 'm' as const,
  capitalize: false,
  tax: '28',
};

/** A pool with a current account, a deposit funded from and paying into it, and two statement lines. */
async function depositPool(ctx: PoolContext) {
  return withPool(ctx, async (tx) => {
    const current = await account(tx, ctx, 'checking', 'Ordem');
    const term = await account(tx, ctx, 'term_deposit', 'Prazo');
    await depositsRepo.insert(tx, ctx, newId(), term.id, {
      ...DEPOSIT,
      payToAccountId: current.id,
      fundFromAccountId: current.id,
    });
    const interest = depositSchedule(
      {
        id: term.id,
        ...DEPOSIT,
        payTo: current.id,
        fundFrom: current.id,
      },
      '2026-06-10',
      '28',
    )[0];
    const capitalLine = await transactionsRepo.insert(
      tx,
      ctx,
      newId(),
      line(current.id, '2026-01-10', '-10000', 'Constituicao deposito'),
    );
    const interestLine = await transactionsRepo.insert(
      tx,
      ctx,
      newId(),
      line(current.id, interest?.date ?? '', interest?.net.toString() ?? '0', 'Juros deposito'),
    );
    return { capitalId: capitalLine.id, interestId: interestLine.id };
  });
}

const lines = (ctx: PoolContext, ids: string[]) =>
  withPool(ctx, async (tx) => {
    const out = [];
    for (const id of ids) out.push(await transactionsRepo.find(tx, ctx, id));
    return out;
  });

describe('deposits.link', () => {
  const job = createDepositsLinkJob({ db: worker.db, withPool: workerWithPool, now: () => TODAY });

  it('links capital as a transfer and interest as deposit interest, once, and only in its pool', async () => {
    const { a, b } = createTwoPools();
    const inA = await depositPool(a.ctx);
    const inB = await depositPool(b.ctx);

    await job.execute({ poolId: a.poolId }, info('deposits.link'));

    const [capital, interest] = await lines(a.ctx, [inA.capitalId, inA.interestId]);
    expect(capital).toMatchObject({ transfer: true, depositInterest: false });
    expect(capital?.depositFlowKey).toMatch(/:2026-01-10:capital$/);
    expect(interest).toMatchObject({ transfer: false, depositInterest: true });
    expect(interest?.depositFlowKey).toMatch(/:interest$/);
    // The other pool is untouched.
    const [otherCapital, otherInterest] = await lines(b.ctx, [inB.capitalId, inB.interestId]);
    expect([otherCapital?.depositFlowKey, otherInterest?.depositFlowKey]).toEqual([null, null]);

    // A second run writes nothing new.
    await job.execute({ poolId: a.poolId }, info('deposits.link'));
    expect(await lines(a.ctx, [inA.capitalId, inA.interestId])).toEqual([capital, interest]);
  });

  it('sweeps every pool when the payload names none', async () => {
    const { a } = createTwoPools();
    const ids = await depositPool(a.ctx);
    expect(await workerPoolsRepo.list(worker.db)).toContain(a.poolId);

    await job.execute({}, info('deposits.link'));

    const [capital] = await lines(a.ctx, [ids.capitalId]);
    expect(capital?.transfer).toBe(true);
  });

  it('keeps a transfer flag the user fixed', async () => {
    const { a } = createTwoPools();
    const ids = await depositPool(a.ctx);
    await withPool(a.ctx, (tx) =>
      transactionsRepo.update(tx, a.ctx, ids.capitalId, { transfer: false, transferLocked: true }),
    );

    await job.execute({ poolId: a.poolId }, info('deposits.link'));

    const [capital] = await lines(a.ctx, [ids.capitalId]);
    expect(capital).toMatchObject({ transfer: false, transferLocked: true });
    expect(capital?.depositFlowKey).not.toBeNull();
  });

  it('rejects a payload that is not a pool id', () => {
    expect(() => {
      job.validate({ poolId: "' OR 1=1 --" });
    }).toThrow();
    expect(() => {
      job.validate({ poolId: newId(), extra: 1 });
    }).toThrow();
  });
});

describe('plans.remind', () => {
  const job = createPlansRemindJob({ db: worker.db, withPool: workerWithPool, now: () => TODAY });

  async function planPool(ctx: PoolContext, day = 5, existed = true) {
    const made = await withPool(ctx, async (tx) => {
      const portfolio = await portfoliosRepo.insert(tx, ctx, newId(), {
        name: 'Reforma',
        color: '#112233',
        currency: 'EUR',
        note: null,
        targets: {},
      });
      const asset = await assetsRepo.insert(tx, ctx, newId(), {
        ticker: 'VWCE',
        symbol: null,
        name: 'VWCE',
        type: 'etf',
        currency: 'EUR',
        sector: null,
        region: null,
        dps: null,
        divMonths: [],
      });
      const plan = await plansRepo.insert(tx, ctx, newId(), {
        portfolioId: portfolio.id,
        assetId: asset.id,
        accountId: null,
        subAccountId: null,
        amount: '100',
        day,
        active: true,
      });
      return { portfolio, asset, plan };
    });
    if (existed) await backdate(ctx.poolId, made.plan.id);
    return made;
  }

  /** The jobs run "in June": plans are backdated so they existed before their day. */
  const backdate = (poolId: string, planId: string) =>
    database.asMigrator(async (pool) => {
      // The owner is bound by FORCE RLS too: the pool is set on the single connection first.
      await pool.query("select set_config('app.pool_id', $1, false)", [poolId]);
      try {
        await pool.query("update plans set updated_at = '2026-05-01T00:00:00Z' where id = $1", [
          planId,
        ]);
      } finally {
        await pool.query("select set_config('app.pool_id', '', false)");
      }
    });

  const open = (ctx: PoolContext, userId = newId()) =>
    withPool(ctx, (tx) => notificationsRepo.listOpen(tx, ctx, userId));

  it('raises one reminder per plan and month, resolves it after the buy and never raises it again', async () => {
    const { a, b } = createTwoPools();
    const inA = await planPool(a.ctx);
    await planPool(b.ctx);

    await job.execute({ poolId: a.poolId }, info('plans.remind'));
    await job.execute({ poolId: a.poolId }, info('plans.remind'));

    const reminders = await open(a.ctx);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({
      planId: inA.plan.id,
      period: '2026-06',
      kind: 'plan_reminder',
    });
    expect(await open(b.ctx)).toEqual([]);

    await withPool(a.ctx, (tx) =>
      investmentOpsRepo.insert(tx, a.ctx, newId(), {
        portfolioId: inA.portfolio.id,
        assetId: inA.asset.id,
        accountId: null,
        subAccountId: null,
        type: 'buy',
        date: '2026-06-05',
        qty: '1',
        price: '100',
        fee: null,
        amount: null,
        gross: null,
        tax: null,
        fromCash: false,
        planId: inA.plan.id,
        planPeriod: '2026-06',
        extId: null,
        note: null,
      }),
    );
    await job.execute({ poolId: a.poolId }, info('plans.remind'));
    expect(await open(a.ctx)).toEqual([]);
    await job.execute({ poolId: a.poolId }, info('plans.remind'));
    expect(await open(a.ctx)).toEqual([]);
  });

  it('does not remind before the plan day, nor for a plan that is switched off', async () => {
    const { a } = createTwoPools();
    const early = await planPool(a.ctx, 10); // today is the 10th: the day has not passed yet
    await withPool(a.ctx, (tx) =>
      plansRepo.update(tx, a.ctx, early.plan.id, {
        portfolioId: early.portfolio.id,
        assetId: early.asset.id,
        accountId: null,
        subAccountId: null,
        amount: '100',
        day: 2,
        active: false,
      }),
    );

    await job.execute({ poolId: a.poolId }, info('plans.remind'));

    expect(await open(a.ctx)).toEqual([]);
  });

  it('does not remind for a plan created after its day of the month', async () => {
    const { a } = createTwoPools();
    // Created now (the real clock is after the mocked June 10), so June 5 never applied to it.
    await planPool(a.ctx, 5, false);

    await job.execute({ poolId: a.poolId }, info('plans.remind'));

    expect(await open(a.ctx)).toEqual([]);
  });

  it('keeps the read state per user', async () => {
    const { a } = createTwoPools();
    await planPool(a.ctx);
    await job.execute({ poolId: a.poolId }, info('plans.remind'));
    const [user1, user2] = [newId(), newId()];
    const [reminder] = await open(a.ctx, user1);

    expect(
      await withPool(a.ctx, (tx) =>
        notificationsRepo.markRead(tx, a.ctx, reminder?.id ?? '', user1),
      ),
    ).toBe(true);

    expect((await open(a.ctx, user1))[0]?.read).toBe(true);
    expect((await open(a.ctx, user2))[0]?.read).toBe(false);
  });

  it('is isolated by RLS: another pool cannot read or mark a notification', async () => {
    const { a, b } = createTwoPools();
    await planPool(a.ctx);
    await job.execute({ poolId: a.poolId }, info('plans.remind'));
    const [reminder] = await open(a.ctx);

    const unfiltered = await withPool(b.ctx, (tx) => tx.execute(sql`select id from notifications`));
    expect(unfiltered.rows).toEqual([]);
    expect(
      await withPool(b.ctx, (tx) =>
        notificationsRepo.markRead(tx, b.ctx, reminder?.id ?? '', newId()),
      ),
    ).toBe(false);
    expect(
      await failureCodeOf(
        withPool(b.ctx, (tx) =>
          tx.execute(
            sql`insert into notifications (id, pool_id, kind, plan_id, period) values (${newId()}, ${a.poolId}, 'plan_reminder', ${newId()}, '2026-06')`,
          ),
        ),
      ),
    ).toBe('42501');
  });
});

describe('worker_pools', () => {
  it('is readable by the worker and not by the app role', async () => {
    const { a } = createTwoPools();
    await withPool(a.ctx, (tx) => account(tx, a.ctx, 'checking', 'Ordem'));
    expect(await workerPoolsRepo.list(worker.db)).toContain(a.poolId);
    expect(await failureCodeOf(workerPoolsRepo.list(database.app.db))).toBe('42501');
    // worker_rw reads it and nothing else: only the trigger writes it.
    const privileges = await database.asMigrator((pool) =>
      pool.query<{ p: string; ok: boolean }>(
        `select p, has_table_privilege('worker_rw', 'public.worker_pools', p) as ok
         from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) as p`,
      ),
    );
    expect(Object.fromEntries(privileges.rows.map((r) => [r.p, r.ok]))).toEqual({
      SELECT: true,
      INSERT: false,
      UPDATE: false,
      DELETE: false,
      TRUNCATE: false,
    });
  });
});
