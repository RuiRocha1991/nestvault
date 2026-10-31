import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assertEveryAppTableHasRls,
  findAppTablesWithoutRls,
  RLS_EXEMPT_TABLES,
} from '@nestvault/db';

import { openTestDatabase } from './harness';

const database = openTestDatabase(2);

afterAll(async () => {
  await database.close();
});

describe('every nestvault_app table has Row-Level Security', () => {
  it('holds for the migrated schema (this is the global guard every new table must pass)', async () => {
    expect(await findAppTablesWithoutRls(database.app.db)).toEqual([]);
    await expect(assertEveryAppTableHasRls(database.app.db)).resolves.toBeUndefined();
  });

  it('knows the exempt global tables from the ticket', () => {
    expect(RLS_EXEMPT_TABLES).toEqual(expect.arrayContaining(['fx_rates', 'import_specs']));
  });

  describe('when a table without RLS is added', () => {
    const tables = ['_no_rls_probe', '_enable_only_probe'] as const;

    beforeAll(async () => {
      await database.asMigrator(async (pool) => {
        await pool.query('CREATE TABLE _no_rls_probe (id uuid PRIMARY KEY, pool_id uuid NOT NULL)');
        // ENABLE without FORCE is not enough: the table owner would bypass the policies.
        await pool.query(
          'CREATE TABLE _enable_only_probe (id uuid PRIMARY KEY, pool_id uuid NOT NULL)',
        );
        await pool.query('ALTER TABLE _enable_only_probe ENABLE ROW LEVEL SECURITY');
      });
    });

    afterAll(async () => {
      await database.asMigrator(async (pool) => {
        for (const table of tables) await pool.query(`DROP TABLE IF EXISTS ${table}`);
      });
    });

    it('the check finds it, including a table that only has ENABLE', async () => {
      expect(await findAppTablesWithoutRls(database.app.db)).toEqual([
        '_enable_only_probe',
        '_no_rls_probe',
      ]);
    });

    it('the assertion fails and names the tables', async () => {
      await expect(assertEveryAppTableHasRls(database.app.db)).rejects.toThrow(
        /_enable_only_probe, _no_rls_probe/,
      );
    });

    it('an exempt table is not reported', async () => {
      const found = await findAppTablesWithoutRls(database.app.db, [
        '_no_rls_probe',
        'fx_rates',
        'index_rates',
        'worker_pools',
      ]);
      expect(found).toEqual(['_enable_only_probe']);
    });
  });

  describe('partitioned tables', () => {
    beforeAll(async () => {
      await database.asMigrator(async (pool) => {
        await pool.query(
          'CREATE TABLE _part_probe (id uuid NOT NULL, pool_id uuid NOT NULL, month date NOT NULL) PARTITION BY RANGE (month)',
        );
        await pool.query(
          "CREATE TABLE _part_probe_2026 PARTITION OF _part_probe FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')",
        );
        await pool.query('ALTER TABLE _part_probe ENABLE ROW LEVEL SECURITY');
        await pool.query('ALTER TABLE _part_probe FORCE ROW LEVEL SECURITY');
      });
    });

    afterAll(async () => {
      await database.asMigrator(async (pool) => {
        await pool.query('DROP TABLE IF EXISTS _part_probe');
      });
    });

    it('checks the parent only: a partition child follows its parent', async () => {
      expect(await findAppTablesWithoutRls(database.app.db)).toEqual([]);
    });
  });
});
