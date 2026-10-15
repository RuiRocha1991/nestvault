import type { Pool, PoolClient } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { openTestDatabase, pgErrorCode } from './harness';

const testDb = openTestDatabase();

afterAll(async () => {
  await testDb.close();
});

/** Runs `run` in a transaction that is always rolled back, so no row or trigger change survives. */
async function inRolledBackTransaction(run: (client: PoolClient) => Promise<void>): Promise<void> {
  await testDb.asIdentityMigrator(async (pool: Pool) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await run(client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
}

async function insertEntry(client: PoolClient, ageDays: number): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `insert into audit_log (id, action, at)
     values (gen_random_uuid(), 'auth.signin', now() - make_interval(days => $1))
     returning id::text`,
    [ageDays],
  );
  return String(inserted.rows[0]?.id);
}

async function failureOf(client: PoolClient, statement: string) {
  await client.query('SAVEPOINT attempt');
  try {
    await client.query(statement);
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT attempt');
    return { code: pgErrorCode(error), message: error instanceof Error ? error.message : '' };
  }
  return { code: 'did-not-fail', message: '' };
}

describe('audit_log insert-only trigger', () => {
  // The migration user owns the table, so it holds UPDATE, DELETE and TRUNCATE without any GRANT.
  // Failing with the trigger error (not 42501 permission denied) proves the second layer works
  // even when the privilege layer is out of the picture.
  it.each([
    ['UPDATE', "update audit_log set action = 'x'"],
    ['DELETE', 'delete from audit_log'],
    ['TRUNCATE', 'truncate audit_log'],
  ])('rejects %s even for the table owner, with the trigger error', async (_name, statement) => {
    await inRolledBackTransaction(async (client) => {
      await insertEntry(client, 0);
      const failure = await failureOf(client, statement);
      expect(failure.message).toMatch(/audit_log is insert-only/);
      expect(failure.code).not.toBe('42501');
      expect(failure.code).not.toBe('did-not-fail');
    });
  });

  it('keeps INSERT and reading unaffected', async () => {
    await inRolledBackTransaction(async (client) => {
      const id = await insertEntry(client, 0);
      const found = await client.query('select 1 from audit_log where id = $1', [id]);
      expect(found.rowCount).toBe(1);
    });
  });

  it('is installed as a row trigger and a truncate trigger, both enabled', async () => {
    await inRolledBackTransaction(async (client) => {
      const triggers = await client.query<{ tgname: string; tgenabled: string }>(
        `select tgname, tgenabled from pg_trigger
         where tgrelid = 'public.audit_log'::regclass and not tgisinternal order by tgname`,
      );
      expect(triggers.rows).toEqual([
        { tgname: 'audit_log_reject_row_rewrite', tgenabled: 'O' },
        { tgname: 'audit_log_reject_truncate', tgenabled: 'O' },
      ]);
    });
  });

  it('runs as SECURITY INVOKER with a fixed search_path', async () => {
    await inRolledBackTransaction(async (client) => {
      const fn = await client.query<{ prosecdef: boolean; proconfig: string[] | null }>(
        `select prosecdef, proconfig from pg_proc where proname = 'audit_log_reject_rewrite'`,
      );
      expect(fn.rows).toEqual([{ prosecdef: false, proconfig: ['search_path=pg_catalog'] }]);
    });
  });

  // Retention path documented in docs/security.md (control 7): the migration user disables the
  // triggers, deletes what is past retention and enables them again, all in one transaction.
  it('lets old rows go only through the documented maintenance procedure', async () => {
    await inRolledBackTransaction(async (client) => {
      const old = await insertEntry(client, 800);
      const recent = await insertEntry(client, 1);
      const cutoff = "now() - interval '730 days'";

      const direct = await failureOf(client, `delete from audit_log where at < ${cutoff}`);
      expect(direct.message).toMatch(/audit_log is insert-only/);

      await client.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_reject_row_rewrite');
      await client.query(`DELETE FROM audit_log WHERE at < ${cutoff}`);
      await client.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_reject_row_rewrite');

      const left = await client.query<{ id: string }>(
        'select id::text from audit_log where id = any($1::uuid[])',
        [[old, recent]],
      );
      expect(left.rows.map((row) => row.id)).toEqual([recent]);

      const after = await failureOf(client, 'delete from audit_log');
      expect(after.message).toMatch(/audit_log is insert-only/);
    });
  });
});
