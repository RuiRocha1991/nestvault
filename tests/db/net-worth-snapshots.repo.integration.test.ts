import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { netWorthSnapshotsRepo, type SnapshotValues } from '@nestvault/db';

import { expectIsolated } from '../support/expect-isolated';

import { createTwoPools, failureCodeOf, openTestDatabase, PG } from './harness';

const database = openTestDatabase(2);
const { withPool } = database;

beforeEach(async () => {
  await database.truncateAll();
});

afterAll(async () => {
  await database.close();
});

const snapshot = (date: string, net = '100.5000', overrides: Partial<SnapshotValues> = {}) => ({
  date,
  net,
  cash: net,
  savings: '0.0000',
  investments: '0.0000',
  byCcy: { EUR: net },
  ...overrides,
});

describe('net worth snapshots repository', () => {
  it('stores a day, replaces it on a rerun and keeps money exact', async () => {
    const { a } = createTwoPools();
    await withPool(a.ctx, (tx) =>
      netWorthSnapshotsRepo.upsertMany(tx, a.ctx, [snapshot('2026-10-21', '0.3000')]),
    );
    await withPool(a.ctx, (tx) =>
      netWorthSnapshotsRepo.upsertMany(tx, a.ctx, [
        snapshot('2026-10-21', '0.1000'),
        snapshot('2026-09-30', '0.2000'),
      ]),
    );
    const rows = await withPool(a.ctx, (tx) =>
      netWorthSnapshotsRepo.listBetween(tx, a.ctx, '2026-01-01', '2026-12-31'),
    );
    expect(rows.map((row) => [row.date, row.net])).toEqual([
      ['2026-09-30', '0.2000'],
      ['2026-10-21', '0.1000'],
    ]);
    const some = await withPool(a.ctx, (tx) =>
      netWorthSnapshotsRepo.listForDates(tx, a.ctx, ['2026-09-30', '2020-01-01']),
    );
    expect(some).toHaveLength(1);
    expect(
      await withPool(a.ctx, (tx) => netWorthSnapshotsRepo.listForDates(tx, a.ctx, [])),
    ).toEqual([]);
  });

  it('never reads or writes another pool (app layer and RLS)', async () => {
    const { a, b } = createTwoPools();
    await withPool(b.ctx, (tx) =>
      netWorthSnapshotsRepo.upsertMany(tx, b.ctx, [snapshot('2026-10-21', '999.0000')]),
    );
    await withPool(a.ctx, (tx) =>
      netWorthSnapshotsRepo.upsertMany(tx, a.ctx, [snapshot('2026-10-21', '1.0000')]),
    );
    // The same day in two pools is two rows, and each pool sees only its own.
    const ofA = await withPool(a.ctx, (tx) =>
      netWorthSnapshotsRepo.listBetween(tx, a.ctx, '2000-01-01', '2100-01-01'),
    );
    expect(ofA.map((row) => row.net)).toEqual(['1.0000']);

    // A select with no pool filter still returns only the pool in context.
    const unfiltered = await withPool(a.ctx, (tx) =>
      tx.execute(sql`select pool_id from net_worth_snapshots`),
    );
    expect(unfiltered.rows).toEqual([{ pool_id: a.poolId }]);

    // An insert for another pool fails the policy.
    const code = await failureCodeOf(
      withPool(a.ctx, (tx) =>
        tx.execute(
          sql`insert into net_worth_snapshots (pool_id, date, net, cash, savings, investments)
              values (${b.poolId}, '2026-01-01', 1, 1, 0, 0)`,
        ),
      ),
    );
    expect(code).toBe(PG.rlsViolation);
  });

  it('is isolated by the repository itself', async () => {
    const seed = (
      tx: Parameters<typeof netWorthSnapshotsRepo.listBetween>[0],
      ctx: Parameters<typeof netWorthSnapshotsRepo.listBetween>[1],
    ) => netWorthSnapshotsRepo.upsertMany(tx, ctx, [snapshot('2026-10-21')]);
    const everything = (
      tx: Parameters<typeof netWorthSnapshotsRepo.listBetween>[0],
      ctx: Parameters<typeof netWorthSnapshotsRepo.listBetween>[1],
    ) => netWorthSnapshotsRepo.listBetween(tx, ctx, '2000-01-01', '2100-01-01');
    await expectIsolated({ database, seed, run: everything, snapshot: everything });
    await expectIsolated({
      database,
      seed,
      run: (tx, ctx) => netWorthSnapshotsRepo.listForDates(tx, ctx, ['2026-10-21']),
      snapshot: everything,
    });
  });

  it('treats an injection payload in by_ccy as data', async () => {
    const { a } = createTwoPools();
    const payload = "'; DROP TABLE net_worth_snapshots; --";
    await withPool(a.ctx, (tx) =>
      netWorthSnapshotsRepo.upsertMany(tx, a.ctx, [
        snapshot('2026-10-21', '1.0000', { byCcy: { [payload]: "' OR 1=1 --" } }),
      ]),
    );
    const [row] = await withPool(a.ctx, (tx) =>
      netWorthSnapshotsRepo.listBetween(tx, a.ctx, '2000-01-01', '2100-01-01'),
    );
    expect(row?.byCcy).toEqual({ [payload]: "' OR 1=1 --" });
  });
});
