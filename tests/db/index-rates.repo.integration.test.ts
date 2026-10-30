import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { testEnv } from '@nestvault/config/node';
import { createAppDatabase, indexRatesRepo } from '@nestvault/db';

import { createTwoPools, failureCodeOf, openTestDatabase } from './harness';

const database = openTestDatabase(2);
const { withPool } = database;
// The writer is the worker role, as in production.
const worker = createAppDatabase(testEnv().TEST_DATABASE_URL_WORKER, 2);

beforeEach(async () => {
  await database.truncateAll();
});

afterAll(async () => {
  await worker.close();
  await database.close();
});

const CHECK_VIOLATION = '23514';
const INSUFFICIENT_PRIVILEGE = '42501';

const row = (
  patch: Partial<{ rateIndex: string; period: string; rate: string; source: string }> = {},
) => ({
  rateIndex: 'euribor_6m',
  period: '2026-09-01',
  rate: '2.15',
  source: 'ecb',
  ...patch,
});

describe('index rates', () => {
  it('stores months, returns the newest and the history from a date, oldest first', async () => {
    const { a } = createTwoPools();
    await indexRatesRepo.upsertMany(worker.db, [
      row({ period: '2026-07-01', rate: '2.1' }),
      row({ period: '2026-09-01', rate: '2.15' }),
      row({ period: '2026-08-01', rate: '2.12' }),
      row({ rateIndex: 'euribor_3m', period: '2026-09-01', rate: '2.0' }),
    ]);
    expect(await withPool(a.ctx, (tx) => indexRatesRepo.latest(tx, 'euribor_6m'))).toMatchObject({
      period: '2026-09-01',
      rate: '2.150000',
    });
    expect(
      (await withPool(a.ctx, (tx) => indexRatesRepo.list(tx, 'euribor_6m', '2026-08-01'))).map(
        (entry) => entry.period,
      ),
    ).toEqual(['2026-08-01', '2026-09-01']);
    expect(await withPool(a.ctx, (tx) => indexRatesRepo.latest(tx, 'euribor_12m'))).toBeUndefined();
  });

  it('is idempotent and corrects a month instead of duplicating it', async () => {
    const { a } = createTwoPools();
    await indexRatesRepo.upsertMany(worker.db, [row()]);
    await indexRatesRepo.upsertMany(worker.db, [row()]);
    await indexRatesRepo.upsertMany(worker.db, [row({ rate: '2.2' })]);
    const list = await withPool(a.ctx, (tx) => indexRatesRepo.list(tx, 'euribor_6m', '2026-01-01'));
    expect(list).toHaveLength(1);
    expect(list[0]?.rate).toBe('2.200000');
    await indexRatesRepo.upsertMany(worker.db, []);
  });

  it('keeps a negative month exact (the Euribor was below zero until 2022)', async () => {
    const { a } = createTwoPools();
    await indexRatesRepo.upsertMany(worker.db, [row({ period: '2021-09-01', rate: '-0.5224091' })]);
    expect((await withPool(a.ctx, (tx) => indexRatesRepo.latest(tx, 'euribor_6m')))?.rate).toBe(
      '-0.522409',
    );
  });

  it.each([
    ['an unknown index', row({ rateIndex: 'libor' })],
    ['a date that is not the first of the month', row({ period: '2026-09-15' })],
    ['a rate below -10', row({ rate: '-10.5' })],
    ['a rate above 100', row({ rate: '100.5' })],
    ['an unknown source', row({ source: 'rumour' })],
  ])('refuses %s (check constraint)', async (_name, values) => {
    expect(await failureCodeOf(indexRatesRepo.upsertMany(worker.db, [values]))).toBe(
      CHECK_VIOLATION,
    );
  });

  it('is read only for app_rw: insert, update and delete are refused', async () => {
    const { a } = createTwoPools();
    await indexRatesRepo.upsertMany(worker.db, [row()]);
    const write = (statement: ReturnType<typeof sql>) =>
      failureCodeOf(withPool(a.ctx, (tx) => tx.execute(statement)));
    expect(
      await write(
        sql`insert into index_rates (rate_index, period, rate, source) values ('euribor_3m', '2026-09-01', 1, 'manual')`,
      ),
    ).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await write(sql`update index_rates set rate = 9`)).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await write(sql`delete from index_rates`)).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('treats a payload as the name of an index, never as SQL', async () => {
    const { a } = createTwoPools();
    await indexRatesRepo.upsertMany(worker.db, [row()]);
    expect(await withPool(a.ctx, (tx) => indexRatesRepo.latest(tx, `' OR 1=1 --`))).toBeUndefined();
    expect(
      await withPool(a.ctx, (tx) =>
        indexRatesRepo.list(tx, `'; DROP TABLE index_rates; --`, '2020-01-01'),
      ),
    ).toEqual([]);
    expect(await withPool(a.ctx, (tx) => indexRatesRepo.latest(tx, 'euribor_6m'))).toBeDefined();
  });
});
