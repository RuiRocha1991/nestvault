import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  assetPricesRepo,
  assetsRepo,
  newId,
  type AssetValues,
  type PoolContext,
  type PoolTx,
} from '@nestvault/db';

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

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

const values = (overrides: Partial<AssetValues> = {}): AssetValues => ({
  ticker: 'VWCE',
  symbol: 'VWCE.DE',
  name: 'Vanguard FTSE All-World',
  type: 'etf',
  currency: 'EUR',
  sector: null,
  region: 'World',
  dps: '1.5',
  divMonths: [3, 6, 9, 12],
  ...overrides,
});

const asset = (tx: PoolTx, ctx: PoolContext, overrides: Partial<AssetValues> = {}) =>
  assetsRepo.insert(tx, ctx, newId(), values(overrides));

describe('assets repository', () => {
  it('inserts, finds, lists, updates and removes inside the pool', async () => {
    const { a } = createTwoPools();
    const id = newId();
    const created = await withPool(a.ctx, (tx) => assetsRepo.insert(tx, a.ctx, id, values()));
    expect(created).toMatchObject({ id, poolId: a.poolId, ticker: 'VWCE', dps: '1.5000' });
    expect(created.divMonths).toEqual([3, 6, 9, 12]);
    expect(await withPool(a.ctx, (tx) => assetsRepo.list(tx, a.ctx))).toHaveLength(1);
    expect((await withPool(a.ctx, (tx) => assetsRepo.find(tx, a.ctx, id)))?.id).toBe(id);

    const updated = await withPool(a.ctx, (tx) =>
      assetsRepo.update(tx, a.ctx, id, values({ name: 'Novo', divMonths: [] })),
    );
    expect(updated).toMatchObject({ name: 'Novo', divMonths: [] });

    expect(await withPool(a.ctx, (tx) => assetsRepo.remove(tx, a.ctx, id))).toBe(true);
    expect(await withPool(a.ctx, (tx) => assetsRepo.find(tx, a.ctx, id))).toBeUndefined();
  });

  it('keeps the price history per day: adds, replaces, reads as of a day, and cascades on delete', async () => {
    const { a } = createTwoPools();
    const created = await withPool(a.ctx, (tx) => asset(tx, a.ctx));
    const put = (date: string, price: string, source: 'manual' | 'bulk' = 'manual') =>
      withPool(a.ctx, (tx) =>
        assetPricesRepo.upsertMany(tx, a.ctx, [{ assetId: created.id, date, price }], source),
      );
    await put('2026-01-10', '100.1');
    await put('2026-02-10', '110');
    await put('2026-02-10', '111.123456', 'bulk');

    const history = await withPool(a.ctx, (tx) =>
      assetPricesRepo.history(tx, a.ctx, created.id, { limit: 10 }),
    );
    expect(history.map((row) => [row.date, row.price, row.source])).toEqual([
      ['2026-02-10', '111.123456', 'bulk'],
      ['2026-01-10', '100.100000', 'manual'],
    ]);

    const asOf = (day: string) =>
      withPool(a.ctx, (tx) => assetPricesRepo.latestAsOf(tx, a.ctx, day));
    expect((await asOf('2026-02-01'))[0]?.price).toBe('100.100000');
    expect((await asOf('2026-12-31'))[0]?.price).toBe('111.123456');
    expect(await asOf('2025-12-31')).toEqual([]);

    expect(
      await withPool(a.ctx, (tx) =>
        assetPricesRepo.history(tx, a.ctx, created.id, { from: '2026-02-01', limit: 10 }),
      ),
    ).toHaveLength(1);

    expect(
      await withPool(a.ctx, (tx) => assetPricesRepo.remove(tx, a.ctx, created.id, '2026-01-10')),
    ).toBe(true);
    await withPool(a.ctx, (tx) => assetsRepo.remove(tx, a.ctx, created.id));
    expect(await asOf('2026-12-31')).toEqual([]);
  });

  it('writes many prices in one statement: one bad row stores none', async () => {
    const { a } = createTwoPools();
    const created = await withPool(a.ctx, (tx) => asset(tx, a.ctx));
    const code = await failureCodeOf(
      withPool(a.ctx, (tx) =>
        assetPricesRepo.upsertMany(
          tx,
          a.ctx,
          [
            { assetId: created.id, date: '2026-01-01', price: '1' },
            { assetId: created.id, date: '2026-01-02', price: '0' },
          ],
          'bulk',
        ),
      ),
    );
    expect(code).toBe(CHECK_VIOLATION);
    expect(
      await withPool(a.ctx, (tx) => assetPricesRepo.history(tx, a.ctx, created.id, { limit: 10 })),
    ).toEqual([]);
  });

  it('counts no operations until the table exists (NES-42)', async () => {
    const { a } = createTwoPools();
    expect(await withPool(a.ctx, (tx) => assetsRepo.countReferences(tx, a.ctx, newId()))).toBe(0);
  });
});

describe('isolation between pools (repository filter and RLS)', () => {
  const seed = async (tx: PoolTx, ctxB: PoolContext) => {
    const created = await asset(tx, ctxB, { ticker: 'BSECRET', name: 'pool B secret' });
    await assetPricesRepo.upsertMany(
      tx,
      ctxB,
      [{ assetId: created.id, date: '2026-01-10', price: '5' }],
      'manual',
    );
    return { id: created.id };
  };
  const snapshot = async (tx: PoolTx, ctxB: PoolContext) => ({
    assets: await assetsRepo.list(tx, ctxB),
    prices: await assetPricesRepo.latestAsOf(tx, ctxB, '2999-01-01'),
  });
  type Seed = Awaited<ReturnType<typeof seed>>;
  const check = (run: (tx: PoolTx, ctxA: PoolContext, seeded: Seed) => Promise<unknown>) =>
    expectIsolated({ database, seed, snapshot, run });

  it('assets: list finds nothing of pool B', () => check((tx, ctxA) => assetsRepo.list(tx, ctxA)));
  it('assets: find finds nothing of pool B', () =>
    check((tx, ctxA, s) => assetsRepo.find(tx, ctxA, s.id)));
  it('assets: update changes nothing of pool B', () =>
    check((tx, ctxA, s) => assetsRepo.update(tx, ctxA, s.id, values({ name: 'hijacked' }))));
  it('assets: remove deletes nothing of pool B', () =>
    check((tx, ctxA, s) => assetsRepo.remove(tx, ctxA, s.id)));
  it('prices: history finds nothing of pool B', () =>
    check((tx, ctxA, s) => assetPricesRepo.history(tx, ctxA, s.id, { limit: 10 })));
  it('prices: latestAsOf finds nothing of pool B', () =>
    check((tx, ctxA) => assetPricesRepo.latestAsOf(tx, ctxA, '2999-01-01')));
  it('prices: remove deletes nothing of pool B', () =>
    check((tx, ctxA, s) => assetPricesRepo.remove(tx, ctxA, s.id, '2026-01-10')));

  it('a price for pool B’s asset cannot be written as pool A (composite foreign key)', async () => {
    const { a, b } = createTwoPools();
    const seeded = await withPool(b.ctx, (tx) => seed(tx, b.ctx));
    const code = await failureCodeOf(
      withPool(a.ctx, (tx) =>
        assetPricesRepo.upsertMany(
          tx,
          a.ctx,
          [{ assetId: seeded.id, date: '2026-03-01', price: '9' }],
          'manual',
        ),
      ),
    );
    expect(code).toBe(FOREIGN_KEY_VIOLATION);
    expect(
      await withPool(b.ctx, (tx) => assetPricesRepo.history(tx, b.ctx, seeded.id, { limit: 10 })),
    ).toHaveLength(1);
  });

  it('shows only the pool rows to a select without a where, and refuses a row for another pool', async () => {
    const { a, b } = createTwoPools();
    await withPool(a.ctx, (tx) => asset(tx, a.ctx));
    await withPool(b.ctx, (tx) => asset(tx, b.ctx));
    const seen = await withPool(a.ctx, async (tx) => [
      ...(await tx.execute(sql`select pool_id from assets`)).rows,
      ...(await tx.execute(sql`select pool_id from asset_prices`)).rows,
    ]);
    expect(seen).toHaveLength(1);
    expect(seen.every((row) => row.pool_id === a.poolId)).toBe(true);
    const code = await failureCodeOf(
      withPool(a.ctx, (tx) =>
        tx.execute(
          sql`insert into assets (id, pool_id, ticker, name, type, ccy) values (${newId()}, ${b.poolId}, 'X', 'x', 'etf', 'EUR')`,
        ),
      ),
    );
    expect(code).toBe(PG.rlsViolation);
  });

  it('sees nothing outside withPool', async () => {
    const { a } = createTwoPools();
    await withPool(a.ctx, (tx) => asset(tx, a.ctx));
    expect((await database.app.pool.query('select * from assets')).rows).toEqual([]);
    expect((await database.app.pool.query('select * from asset_prices')).rows).toEqual([]);
  });
});

describe('constraints', () => {
  it('stores SQL injection payloads in text fields literally', async () => {
    const { a } = createTwoPools();
    const payload = "'; DROP TABLE assets; --";
    const created = await withPool(a.ctx, (tx) =>
      asset(tx, a.ctx, { name: "' OR 1=1 --", symbol: payload, sector: payload, region: payload }),
    );
    expect(await withPool(a.ctx, (tx) => assetsRepo.find(tx, a.ctx, created.id))).toMatchObject({
      name: "' OR 1=1 --",
      symbol: payload,
    });
    expect(await withPool(a.ctx, (tx) => assetsRepo.list(tx, a.ctx))).toHaveLength(1);
  });

  it('keeps a ticker unique inside a pool only', async () => {
    const { a, b } = createTwoPools();
    await withPool(a.ctx, (tx) => asset(tx, a.ctx));
    expect(await failureCodeOf(withPool(a.ctx, (tx) => asset(tx, a.ctx, { name: 'dup' })))).toBe(
      UNIQUE_VIOLATION,
    );
    await withPool(b.ctx, (tx) => asset(tx, b.ctx));
  });

  it('rejects a bad ticker, type, currency, dividend and month list', async () => {
    const { a } = createTwoPools();
    const insert = (overrides: Partial<AssetValues>) =>
      failureCodeOf(withPool(a.ctx, (tx) => asset(tx, a.ctx, overrides)));
    expect(await insert({ ticker: 'vwce' })).toBe(CHECK_VIOLATION);
    expect(await insert({ ticker: 'A B' })).toBe(CHECK_VIOLATION);
    expect(await insert({ type: 'nft' })).toBe(CHECK_VIOLATION);
    expect(await insert({ currency: 'euro' })).toBe(CHECK_VIOLATION);
    expect(await insert({ dps: '-1' })).toBe(CHECK_VIOLATION);
    expect(await insert({ divMonths: [13] })).toBe(CHECK_VIOLATION);
    expect(await insert({ divMonths: [0] })).toBe(CHECK_VIOLATION);
    expect(await insert({ name: '' })).toBe(CHECK_VIOLATION);
  });

  it('rejects a price that is not positive or has an unknown source', async () => {
    const { a } = createTwoPools();
    const created = await withPool(a.ctx, (tx) => asset(tx, a.ctx));
    const code = await failureCodeOf(
      withPool(a.ctx, (tx) =>
        tx.execute(
          sql`insert into asset_prices (pool_id, asset_id, date, price, source) values (${a.poolId}, ${created.id}, '2026-01-01', 1, 'rumour')`,
        ),
      ),
    );
    expect(code).toBe(CHECK_VIOLATION);
  });
});
