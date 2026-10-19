import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { fxRatesRepo, newId, poolSettingsRepo, type PoolSettingsValues } from '@nestvault/db';

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
const INSUFFICIENT_PRIVILEGE = '42501';

const values = (overrides: Partial<PoolSettingsValues> = {}): PoolSettingsValues => ({
  transferWindowDays: 3,
  depositTax: '28',
  dividendTax: '28',
  displayCurrency: 'EUR',
  fxOverrides: {},
  ...overrides,
});

type Tx = Parameters<typeof poolSettingsRepo.find>[0];
type Ctx = Parameters<typeof poolSettingsRepo.find>[1];

describe('pool settings repository', () => {
  it('finds nothing before the first save, then creates and replaces the one row of the pool', async () => {
    const { a } = createTwoPools();
    expect(await withPool(a.ctx, (tx) => poolSettingsRepo.find(tx, a.ctx))).toBeUndefined();

    const created = await withPool(a.ctx, (tx) =>
      poolSettingsRepo.upsert(tx, a.ctx, newId(), values({ depositTax: '25' }), null),
    );
    expect(created).toMatchObject({ poolId: a.poolId, depositTax: '25.000000', updatedBy: null });

    const replaced = await withPool(a.ctx, (tx) =>
      poolSettingsRepo.upsert(
        tx,
        a.ctx,
        newId(),
        values({ transferWindowDays: 7, fxOverrides: { USD: '0.9' } }),
        null,
      ),
    );
    expect(replaced).toMatchObject({
      id: created.id,
      transferWindowDays: 7,
      fxOverrides: { USD: '0.9' },
    });
    const count = await withPool(a.ctx, (tx) =>
      tx.execute(sql`select count(*)::int as n from pool_settings`),
    );
    expect(count.rows).toEqual([{ n: 1 }]);
  });
});

describe('isolation between pools (repository filter and RLS)', () => {
  const seed = (tx: Tx, ctxB: Ctx) =>
    poolSettingsRepo.upsert(tx, ctxB, newId(), values({ depositTax: '11' }), null);
  const snapshot = (tx: Tx, ctxB: Ctx) => poolSettingsRepo.find(tx, ctxB);

  it('find finds nothing of pool B', () =>
    expectIsolated({
      database,
      seed,
      snapshot,
      run: (tx, ctxA) => poolSettingsRepo.find(tx, ctxA),
    }));

  it('upsert as pool A never touches the row of pool B', async () => {
    const { a, b } = createTwoPools();
    await withPool(b.ctx, (tx) => seed(tx, b.ctx));
    await withPool(a.ctx, (tx) =>
      poolSettingsRepo.upsert(tx, a.ctx, newId(), values({ depositTax: '5' }), null),
    );
    const kept = await withPool(b.ctx, (tx) => poolSettingsRepo.find(tx, b.ctx));
    expect(kept?.depositTax).toBe('11.000000');
  });

  it('shows only the pool row to a select without a where, and refuses a row for another pool', async () => {
    const { a, b } = createTwoPools();
    await withPool(a.ctx, (tx) => poolSettingsRepo.upsert(tx, a.ctx, newId(), values(), null));
    await withPool(b.ctx, (tx) => poolSettingsRepo.upsert(tx, b.ctx, newId(), values(), null));

    const seen = await withPool(a.ctx, (tx) => tx.execute(sql`select pool_id from pool_settings`));
    expect(seen.rows).toEqual([{ pool_id: a.poolId }]);

    const code = await failureCodeOf(
      withPool(a.ctx, (tx) =>
        tx.execute(sql`insert into pool_settings (id, pool_id) values (${newId()}, ${b.poolId})`),
      ),
    );
    expect(code).toBe(PG.rlsViolation);
  });

  it('sees nothing outside withPool', async () => {
    const { a } = createTwoPools();
    await withPool(a.ctx, (tx) => poolSettingsRepo.upsert(tx, a.ctx, newId(), values(), null));
    expect((await database.app.pool.query('select * from pool_settings')).rows).toEqual([]);
  });
});

describe('constraints', () => {
  it('stores SQL injection payloads in the overrides literally', async () => {
    const { a } = createTwoPools();
    const payload = "'; DROP TABLE pool_settings; --";
    await withPool(a.ctx, (tx) =>
      poolSettingsRepo.upsert(tx, a.ctx, newId(), values({ fxOverrides: { USD: payload } }), null),
    );
    const row = await withPool(a.ctx, (tx) => poolSettingsRepo.find(tx, a.ctx));
    expect(row?.fxOverrides).toEqual({ USD: payload });
  });

  it('rejects a window beyond 30 days, a tax above 100, a bad currency and a non-object override', async () => {
    const { a } = createTwoPools();
    const save = (data: PoolSettingsValues) =>
      failureCodeOf(
        withPool(a.ctx, (tx) => poolSettingsRepo.upsert(tx, a.ctx, newId(), data, null)),
      );
    expect(await save(values({ transferWindowDays: 31 }))).toBe(CHECK_VIOLATION);
    expect(await save(values({ depositTax: '101' }))).toBe(CHECK_VIOLATION);
    expect(await save(values({ displayCurrency: 'euro' }))).toBe(CHECK_VIOLATION);
    const code = await failureCodeOf(
      withPool(a.ctx, (tx) =>
        tx.execute(
          sql`insert into pool_settings (id, pool_id, fx_overrides) values (${newId()}, ${a.poolId}, '[]'::jsonb)`,
        ),
      ),
    );
    expect(code).toBe(CHECK_VIOLATION);
  });
});

describe('fx rates (global, read only)', () => {
  it('returns the seeded rate of each currency, the newest on or before the day', async () => {
    const { a } = createTwoPools();
    const rates = await withPool(a.ctx, (tx) => fxRatesRepo.latestAsOf(tx, '2026-06-01'));
    expect(rates.map((rate) => rate.ccy).sort()).toEqual(['CHF', 'GBP', 'USD']);
    expect(rates.every((rate) => rate.source === 'seed')).toBe(true);
    expect(await withPool(a.ctx, (tx) => fxRatesRepo.latestAsOf(tx, '2025-12-31'))).toEqual([]);
  });

  it('treats a payload as a date value, never as SQL', async () => {
    const { a } = createTwoPools();
    const code = await failureCodeOf(
      withPool(a.ctx, (tx) => fxRatesRepo.latestAsOf(tx, "2026-01-01' OR 1=1 --")),
    );
    expect(code).not.toBeUndefined();
    expect(await withPool(a.ctx, (tx) => fxRatesRepo.latestAsOf(tx, '2026-01-01'))).toHaveLength(3);
  });

  it('refuses every write from app_rw', async () => {
    const { a } = createTwoPools();
    const write = (statement: ReturnType<typeof sql>) =>
      failureCodeOf(withPool(a.ctx, (tx) => tx.execute(statement)));
    expect(
      await write(
        sql`insert into fx_rates (date, ccy, eur_rate, source) values ('2026-02-01', 'USD', 1, 'manual')`,
      ),
    ).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await write(sql`update fx_rates set eur_rate = 2`)).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await write(sql`delete from fx_rates`)).toBe(INSUFFICIENT_PRIVILEGE);
  });
});
