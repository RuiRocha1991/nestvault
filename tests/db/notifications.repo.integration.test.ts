import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  assetsRepo,
  newId,
  NOTIFICATION_KINDS,
  notificationsRepo,
  plansRepo,
  portfoliosRepo,
  type PoolContext,
  type PoolTx,
} from '@nestvault/db';

import { expectIsolated } from '../support/expect-isolated';

import { createTwoPools, failureCodeOf, openTestDatabase } from './harness';

const database = openTestDatabase(2);
const { withPool } = database;

beforeEach(async () => {
  await database.truncateAll();
});

afterAll(async () => {
  await database.close();
});

const USER = newId();
const OTHER_USER = newId();

/** A plan in the pool and one reminder per period; returns the reminder ids. */
async function reminders(tx: PoolTx, ctx: PoolContext, periods: string[]) {
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
    day: 5,
    active: true,
  });
  const ids: string[] = [];
  for (const period of periods) {
    const id = newId();
    await notificationsRepo.raisePlanReminder(tx, ctx, id, plan.id, period);
    ids.push(id);
  }
  return { planId: plan.id, ids };
}

describe('notificationsRepo.markRead', () => {
  it('says marked, already or missing, and writes no row for a resolved notification', async () => {
    const { a } = createTwoPools();
    const { ids } = await withPool(a.ctx, (tx) => reminders(tx, a.ctx, ['2026-01', '2026-02']));
    const [open, resolved] = [ids[0] ?? '', ids[1] ?? ''];
    await withPool(a.ctx, (tx) => notificationsRepo.resolve(tx, a.ctx, [resolved]));

    const mark = (id: string) =>
      withPool(a.ctx, (tx) => notificationsRepo.markRead(tx, a.ctx, id, USER));
    expect(await mark(open)).toBe('marked');
    expect(await mark(open)).toBe('already');
    expect(await mark(resolved)).toBe('missing');
    expect(await mark(newId())).toBe('missing');

    const reads = await withPool(a.ctx, (tx) =>
      tx.execute(sql`select notification_id from notification_reads`),
    );
    expect(reads.rows).toEqual([{ notification_id: open }]);
  });
});

describe('notifications.kind', () => {
  it('keeps NOTIFICATION_KINDS equal to the values of the CHECK constraint', async () => {
    const { a } = createTwoPools();
    const result = await withPool(a.ctx, (tx) =>
      tx.execute(
        sql`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'notifications_kind_known'`,
      ),
    );
    const def = String((result.rows[0] as { def?: string } | undefined)?.def);
    const inDb = [...def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(inDb).toEqual([...NOTIFICATION_KINDS].sort());
  });
});

describe('notificationsRepo.markAllRead', () => {
  it('marks the open notifications for one user only and is idempotent', async () => {
    const { a } = createTwoPools();
    const { ids } = await withPool(a.ctx, (tx) => reminders(tx, a.ctx, ['2026-01', '2026-02']));
    const [first] = ids;
    await withPool(a.ctx, (tx) => notificationsRepo.markRead(tx, a.ctx, first ?? '', USER));

    expect(await withPool(a.ctx, (tx) => notificationsRepo.markAllRead(tx, a.ctx, USER))).toBe(1);
    expect(await withPool(a.ctx, (tx) => notificationsRepo.markAllRead(tx, a.ctx, USER))).toBe(0);

    const mine = await withPool(a.ctx, (tx) => notificationsRepo.listOpen(tx, a.ctx, USER));
    const theirs = await withPool(a.ctx, (tx) => notificationsRepo.listOpen(tx, a.ctx, OTHER_USER));
    expect(mine.map((n) => n.read)).toEqual([true, true]);
    expect(theirs.map((n) => n.read)).toEqual([false, false]);
  });

  it('skips resolved notifications', async () => {
    const { a } = createTwoPools();
    const { ids } = await withPool(a.ctx, (tx) => reminders(tx, a.ctx, ['2026-01', '2026-02']));
    await withPool(a.ctx, (tx) => notificationsRepo.resolve(tx, a.ctx, [ids[0] ?? '']));
    expect(await withPool(a.ctx, (tx) => notificationsRepo.markAllRead(tx, a.ctx, USER))).toBe(1);
    const reads = await withPool(a.ctx, (tx) =>
      tx.execute(sql`select notification_id from notification_reads`),
    );
    expect(reads.rows).toEqual([{ notification_id: ids[1] }]);
  });
});

describe('notifications isolation', () => {
  const seed = (tx: PoolTx, ctxB: PoolContext) => reminders(tx, ctxB, ['2026-03']);
  const snapshot = async (tx: PoolTx, ctxB: PoolContext) =>
    notificationsRepo.listOpen(tx, ctxB, USER);
  type Seed = Awaited<ReturnType<typeof seed>>;
  const check = (run: (tx: PoolTx, ctxA: PoolContext, seeded: Seed) => Promise<unknown>) =>
    expectIsolated({ database, seed, snapshot, run });

  it('listOpen finds nothing of pool B', () =>
    check((tx, ctxA) => notificationsRepo.listOpen(tx, ctxA, USER)));
  it('markRead marks nothing of pool B', () =>
    check(async (tx, ctxA, s) => {
      const result = await notificationsRepo.markRead(tx, ctxA, s.ids[0] ?? '', USER);
      return result === 'missing' ? undefined : result; // 'missing' is the empty answer
    }));
  it('markAllRead marks nothing of pool B', () =>
    check((tx, ctxA) => notificationsRepo.markAllRead(tx, ctxA, USER)));
});

describe('notifications SQL injection', () => {
  it('treats payloads as data: ids are bound uuid parameters, nothing is executed', async () => {
    const { a } = createTwoPools();
    await withPool(a.ctx, (tx) => reminders(tx, a.ctx, ['2026-03']));
    for (const payload of ["' OR 1=1 --", "'; DROP TABLE notifications; --"]) {
      await expect(
        failureCodeOf(
          withPool(a.ctx, (tx) => notificationsRepo.markRead(tx, a.ctx, payload, USER)),
        ),
      ).resolves.toBe('22P02');
      await expect(
        failureCodeOf(withPool(a.ctx, (tx) => notificationsRepo.markAllRead(tx, a.ctx, payload))),
      ).resolves.toBe('22P02');
    }
    const open = await withPool(a.ctx, (tx) => notificationsRepo.listOpen(tx, a.ctx, USER));
    expect(open).toHaveLength(1);
    expect(open[0]?.read).toBe(false);
  });
});
