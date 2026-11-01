import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { netWorthSnapshotsRepo } from '@nestvault/db';

import { createTwoPools, openTestDatabase } from './harness';

const database = openTestDatabase(2);
const { withPool } = database;

beforeEach(async () => {
  await database.truncateAll();
});

afterAll(async () => {
  await database.close();
});

/**
 * Tables with a pool_id that do not feed the net worth. A new pool table must either invalidate the
 * snapshots (migration 0020) or be listed here on purpose: the test below fails until one is done.
 */
const NO_EFFECT_ON_NET_WORTH = [
  'account_holders',
  'categories',
  'category_rules',
  'goal_scopes',
  'goals',
  'holders',
  'import_batches',
  'loan_fields',
  'month_notes',
  'net_worth_snapshots',
  'plans',
  'pool_category_settings',
  'sub_accounts',
];

const row = (date: string) => ({
  date,
  net: '1.0000',
  cash: '1.0000',
  savings: '0.0000',
  investments: '0.0000',
  byCcy: {},
});

describe('snapshot invalidation triggers', () => {
  it('covers every pool table or lists it as without effect on the net worth', async () => {
    const rows = await database.asMigrator(async (pool) => {
      const result = await pool.query<{ table_name: string; triggered: boolean }>(`
        select c.table_name,
               exists (
                 select 1 from pg_trigger t
                 where t.tgrelid = format('public.%I', c.table_name)::regclass
                   and t.tgname like '%\\_snapshots\\_ins'
               ) as triggered
        from information_schema.columns c
        join information_schema.tables t using (table_schema, table_name)
        where c.table_schema = 'public' and c.column_name = 'pool_id' and c.table_name not like E'\\_%'
          and t.table_type = 'BASE TABLE'
        order by 1
      `);
      return result.rows;
    });
    const unaccounted = rows
      .filter((r) => !r.triggered && !NO_EFFECT_ON_NET_WORTH.includes(r.table_name))
      .map((r) => r.table_name);
    expect(unaccounted).toEqual([]);
    expect(
      rows.filter((r) => r.triggered && NO_EFFECT_ON_NET_WORTH.includes(r.table_name)),
    ).toEqual([]);
  });

  it('a statement that changes no row deletes nothing', async () => {
    const { a } = createTwoPools();
    await withPool(a.ctx, (tx) =>
      netWorthSnapshotsRepo.upsertMany(tx, a.ctx, [row('2026-08-31'), row('2026-09-30')]),
    );
    await withPool(a.ctx, (tx) => tx.execute(sql`update accounts set name = name where false`));
    await withPool(a.ctx, (tx) => tx.execute(sql`delete from transactions where false`));
    const rows = await withPool(a.ctx, (tx) =>
      netWorthSnapshotsRepo.listBetween(tx, a.ctx, '2000-01-01', '2100-01-01'),
    );
    expect(rows).toHaveLength(2);
  });
});
