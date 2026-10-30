import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { testEnv } from '@nestvault/config/node';
import { runMigrations } from '@nestvault/db/migrate';

async function query<T extends Record<string, unknown>>(url: string, text: string): Promise<T[]> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    return (await pool.query<T>(text)).rows;
  } finally {
    await pool.end();
  }
}

describe('migrations', () => {
  const env = testEnv();
  const targets = {
    identityUrl: env.TEST_MIGRATOR_URL_IDENTITY,
    appUrl: env.TEST_MIGRATOR_URL_APP,
  };
  const migrationRows = (url: string) =>
    query<{ n: string }>(url, 'select count(*)::text as n from drizzle.__drizzle_migrations');

  it('are applied by the global setup to both databases', async () => {
    expect((await migrationRows(targets.identityUrl))[0]?.n).toBe('8');
    expect((await migrationRows(targets.appUrl))[0]?.n).toBe('17');
  });

  it('are idempotent: running them again changes nothing and does not fail', async () => {
    await runMigrations(targets);
    await runMigrations(targets);
    expect((await migrationRows(targets.identityUrl))[0]?.n).toBe('8');
    expect((await migrationRows(targets.appUrl))[0]?.n).toBe('17');
  });

  it('keep the two databases separate: each has its own migration history and objects', async () => {
    const identity = await query<{ extname: string }>(
      targets.identityUrl,
      "select extname from pg_extension where extname = 'citext'",
    );
    expect(identity).toHaveLength(1);

    const identityHasPoolFunction = await query(
      targets.identityUrl,
      "select 1 from pg_proc where proname = 'app_current_pool_id'",
    );
    expect(identityHasPoolFunction).toHaveLength(0);

    const appHasPoolFunction = await query(
      targets.appUrl,
      "select 1 from pg_proc where proname = 'app_current_pool_id'",
    );
    expect(appHasPoolFunction).toHaveLength(1);
  });
});
