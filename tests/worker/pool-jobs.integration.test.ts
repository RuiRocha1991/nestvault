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
import { createLogger, remindPlansInPool } from '@nestvault/services';

import { createWorkerPoolRunner } from '../../apps/worker/src/database';
import { createDepositsLinkJob, createPlansRemindJob } from '../../apps/worker/src/jobs/pool-jobs';
import { createPoolsReconcileJob } from '../../apps/worker/src/jobs/pools-reconcile';
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

  async function planPool(ctx: PoolContext, day = 5, existed: string | boolean = true) {
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
    if (existed) {
      await backdate(ctx.poolId, made.plan.id, typeof existed === 'string' ? existed : undefined);
    }
    return made;
  }

  /** The jobs run "in June": plans are backdated so they were active before their day. */
  const backdate = (poolId: string, planId: string, at = '2026-06-01T00:00:00Z') =>
    database.asMigrator(async (pool) => {
      // The owner is bound by FORCE RLS too: the pool is set on the single connection first.
      await pool.query("select set_config('app.pool_id', $1, false)", [poolId]);
      try {
        await pool.query('update plans set activated_at = $2 where id = $1', [planId, at]);
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

  const buyFor = (
    ctx: PoolContext,
    made: Awaited<ReturnType<typeof planPool>>,
    date: string,
    planPeriod: string | null,
  ) =>
    withPool(ctx, (tx) =>
      investmentOpsRepo.insert(tx, ctx, newId(), {
        portfolioId: made.portfolio.id,
        assetId: made.asset.id,
        accountId: null,
        subAccountId: null,
        type: 'buy',
        date,
        qty: '1',
        price: '100',
        fee: null,
        amount: null,
        gross: null,
        tax: null,
        fromCash: false,
        planId: planPeriod ? made.plan.id : null,
        planPeriod,
        extId: null,
        note: null,
      }),
    );

  it('catches up the months missed while the worker was down, inside the window, once', async () => {
    const { a } = createTwoPools();
    // Active since March; today is June 10, plan day 5: April, May and June are late, March is out of the window.
    const made = await planPool(a.ctx, 5, '2026-03-01T00:00:00Z');
    await buyFor(a.ctx, made, '2026-05-07', null); // a manual buy of the asset answers May

    const first = await withPool(a.ctx, (tx) => remindPlansInPool(tx, a.ctx, '2026-06-10'));
    expect(first).toEqual({ raised: 2, resolved: 0, expired: 0 });
    expect((await open(a.ctx)).map((n) => n.period).sort()).toEqual(['2026-04', '2026-06']);

    const again = await withPool(a.ctx, (tx) => remindPlansInPool(tx, a.ctx, '2026-06-10'));
    expect(again).toEqual({ raised: 0, resolved: 0, expired: 0 });
  });

  it('expires open reminders of months older than the window, and resolves the answered ones', async () => {
    const { a } = createTwoPools();
    const made = await planPool(a.ctx, 5, '2026-01-01T00:00:00Z');
    // The worker ran in March and raised that month's reminder, then it was down until June.
    await withPool(a.ctx, (tx) =>
      notificationsRepo.raisePlanReminder(tx, a.ctx, newId(), made.plan.id, '2026-03'),
    );
    await withPool(a.ctx, (tx) =>
      notificationsRepo.raisePlanReminder(tx, a.ctx, newId(), made.plan.id, '2026-04'),
    );
    await buyFor(a.ctx, made, '2026-04-06', '2026-04'); // April was bought meanwhile

    const outcome = await withPool(a.ctx, (tx) => remindPlansInPool(tx, a.ctx, '2026-06-10'));
    expect(outcome).toEqual({ raised: 2, resolved: 1, expired: 1 });
    expect((await open(a.ctx)).map((n) => n.period).sort()).toEqual(['2026-05', '2026-06']);
    // The expired month is not raised again: it is out of the window and the row stays as a record.
    const again = await withPool(a.ctx, (tx) => remindPlansInPool(tx, a.ctx, '2026-06-10'));
    expect(again).toEqual({ raised: 0, resolved: 0, expired: 0 });
  });

  it('counts a plan from the day it was switched on, not from its last edit', async () => {
    const { a } = createTwoPools();
    const made = await planPool(a.ctx, 5, '2026-05-20T00:00:00Z'); // active since May 20: May 5 never applied
    const values = {
      portfolioId: made.portfolio.id,
      assetId: made.asset.id,
      accountId: null,
      subAccountId: null,
      amount: '250',
      day: 5,
      active: true,
    };
    // Editing the amount after the day keeps the activation date...
    const edited = await withPool(a.ctx, (tx) => plansRepo.update(tx, a.ctx, made.plan.id, values));
    expect(edited?.activatedAt.toISOString()).toBe('2026-05-20T00:00:00.000Z');
    await withPool(a.ctx, (tx) => remindPlansInPool(tx, a.ctx, '2026-06-10'));
    expect((await open(a.ctx)).map((n) => n.period)).toEqual(['2026-06']);

    // ...and switching it off and on again starts a new activation.
    await withPool(a.ctx, (tx) =>
      plansRepo.update(tx, a.ctx, made.plan.id, { ...values, active: false }),
    );
    const back = await withPool(a.ctx, (tx) => plansRepo.update(tx, a.ctx, made.plan.id, values));
    expect(back?.activatedAt.getTime()).toBeGreaterThan(Date.parse('2026-06-10T00:00:00Z'));
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

describe('pools.reconcile', () => {
  const job = createPoolsReconcileJob({ db: worker.db });
  /** Runs SQL as the owner on the single connection, with no pool set (what a restore script would do). */
  const asOwner = (sqlText: string, params: unknown[] = []) =>
    database.asMigrator((pool) => pool.query(sqlText, params));

  it('adds a pool whose accounts skipped the trigger and drops a pool with no data', async () => {
    const { a } = createTwoPools();
    await withPool(a.ctx, (tx) => account(tx, a.ctx, 'checking', 'Ordem'));
    // A restore: the data is there but the row of worker_pools never was.
    await asOwner('delete from worker_pools where pool_id = $1', [a.poolId]);
    expect(await workerPoolsRepo.list(worker.db)).not.toContain(a.poolId);
    // A deleted pool: listed, but no account is left.
    const gone = newId();
    await asOwner('insert into worker_pools (pool_id) values ($1)', [gone]);

    await job.execute({}, info('pools.reconcile'));

    const listed = await workerPoolsRepo.list(worker.db);
    expect(listed).toContain(a.poolId);
    expect(listed).not.toContain(gone);
    // Idempotent.
    await job.execute({}, info('pools.reconcile'));
    expect(await workerPoolsRepo.list(worker.db)).toEqual(listed);
  });

  it('is the only way the worker changes the list, and the app role cannot call it', async () => {
    expect(await failureCodeOf(workerPoolsRepo.reconcile(database.app.db))).toBe('42501');
    expect(await failureCodeOf(worker.db.execute(sql`delete from worker_pools where true`))).toBe(
      '42501',
    );
  });
});
