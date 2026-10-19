import { Pool } from 'pg';

import { testEnv } from '@nestvault/config/node';
import { createAppDatabase, createWithPool } from '@nestvault/db';
import type { AppDatabase, PoolContext, PoolRunner, Role } from '@nestvault/db';
import { runMigrations } from '@nestvault/db/migrate';

import { asMember, createPool } from '../support/factories';

import { loadLocalEnv } from './load-env';
import { PROBE_TABLE_SQL } from './probe';

async function withMigrator<T>(url: string, run: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({
    connectionString: url,
    max: 1,
    application_name: 'nestvault-test-migrator',
  });
  try {
    return await run(pool);
  } finally {
    await pool.end();
  }
}

/** Drops every table (and Drizzle's bookkeeping) so the next migration run starts from nothing. */
const DROP_EVERYTHING = `
  DO $$
  DECLARE r record;
  BEGIN
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
      EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
    END LOOP;
  END $$;
  DROP SCHEMA IF EXISTS drizzle CASCADE;
`;

// `fx_rates` and the global rows of `categories` are reference data seeded by migrations: tests read
// them and never reset them.
const TRUNCATE_EVERYTHING = `
  DO $$
  DECLARE tables text;
  BEGIN
    SELECT string_agg(format('public.%I', tablename), ', ') INTO tables
    FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('fx_rates', 'categories');
    IF tables IS NOT NULL THEN
      EXECUTE 'TRUNCATE ' || tables || ' RESTART IDENTITY CASCADE';
    END IF;
  END $$;
`;

/**
 * What a test left in `categories`: the pools' own rows go, the global catalogue stays. The table is
 * FORCE row-level secured, so even its owner only sees global rows; the policy is lifted just for
 * the delete and put back in the same transaction.
 */
export const RESET_POOL_CATEGORIES = `
  BEGIN;
  ALTER TABLE public.categories NO FORCE ROW LEVEL SECURITY;
  DELETE FROM public.categories WHERE pool_id IS NOT NULL;
  ALTER TABLE public.categories FORCE ROW LEVEL SECURITY;
  COMMIT;
`;

/** Every row of `categories`, global and pools', for a test that wants to see what a call left. */
export async function allCategories(pool: Pool): Promise<unknown[]> {
  await pool.query('ALTER TABLE public.categories NO FORCE ROW LEVEL SECURITY');
  try {
    const result = await pool.query<Record<string, unknown>>(
      'select * from public.categories order by id',
    );
    return result.rows;
  } finally {
    await pool.query('ALTER TABLE public.categories FORCE ROW LEVEL SECURITY');
  }
}

/**
 * `audit_log` rejects TRUNCATE for every role, so resetting the identity database goes through the
 * documented maintenance path: disable the triggers, truncate, re-enable, all in one transaction.
 */
const TRUNCATE_IDENTITY = `
  BEGIN;
  ALTER TABLE public.audit_log DISABLE TRIGGER audit_log_reject_row_rewrite;
  ALTER TABLE public.audit_log DISABLE TRIGGER audit_log_reject_truncate;
  ${TRUNCATE_EVERYTHING}
  ALTER TABLE public.audit_log ENABLE TRIGGER audit_log_reject_row_rewrite;
  ALTER TABLE public.audit_log ENABLE TRIGGER audit_log_reject_truncate;
  COMMIT;
`;

/**
 * Once per test run: reset the `_test` databases, apply the real migrations, then add the probe
 * table. The migration user owns the databases but cannot create new ones, and dropping the
 * schema would lose the default privileges for app_rw, so tables are dropped one by one.
 */
export async function prepareTestDatabases(): Promise<void> {
  loadLocalEnv();
  const env = testEnv();
  try {
    await Promise.all([
      withMigrator(env.TEST_MIGRATOR_URL_IDENTITY, (pool) => pool.query(DROP_EVERYTHING)),
      withMigrator(env.TEST_MIGRATOR_URL_APP, (pool) => pool.query(DROP_EVERYTHING)),
    ]);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown';
    throw new Error(
      `Cannot reach the test databases (error code: ${code}). Start them with: pnpm db:up`,
      { cause: error },
    );
  }
  await runMigrations({
    identityUrl: env.TEST_MIGRATOR_URL_IDENTITY,
    appUrl: env.TEST_MIGRATOR_URL_APP,
  });
  await withMigrator(env.TEST_MIGRATOR_URL_APP, (pool) => pool.query(PROBE_TABLE_SQL));
}

export interface TestDatabase {
  /** `app_rw`: what the application uses (RLS applies). */
  app: AppDatabase;
  withPool: PoolRunner;
  /** Run SQL as the migration user (owner) against the app test database. */
  asMigrator<T>(run: (pool: Pool) => Promise<T>): Promise<T>;
  /** Run SQL as the migration user (owner) against the identity test database. */
  asIdentityMigrator<T>(run: (pool: Pool) => Promise<T>): Promise<T>;
  /** Empty every table in both databases between tests. */
  truncateAll(): Promise<void>;
  close(): Promise<void>;
}

/** `maxConnections: 1` forces connection reuse, which is how a leaked setting would show up. */
export function openTestDatabase(maxConnections = 4): TestDatabase {
  loadLocalEnv();
  const env = testEnv();
  const app = createAppDatabase(env.TEST_DATABASE_URL_APP, maxConnections);
  return {
    app,
    withPool: createWithPool(() => app),
    asMigrator: (run) => withMigrator(env.TEST_MIGRATOR_URL_APP, run),
    asIdentityMigrator: (run) => withMigrator(env.TEST_MIGRATOR_URL_IDENTITY, run),
    async truncateAll() {
      await Promise.all([
        withMigrator(env.TEST_MIGRATOR_URL_APP, async (pool) => {
          await pool.query(TRUNCATE_EVERYTHING);
          await pool.query(RESET_POOL_CATEGORIES);
        }),
        withMigrator(env.TEST_MIGRATOR_URL_IDENTITY, (pool) => pool.query(TRUNCATE_IDENTITY)),
      ]);
    },
    close: () => app.close(),
  };
}

export interface TestPool {
  poolId: string;
  userId: string;
  ctx: PoolContext;
}

const PROBE_PERMISSIONS = ['probe.read', 'probe.write'];

export function createTestPool(role: Exclude<Role, 'system'> = 'owner'): TestPool {
  const pool = createPool();
  return {
    poolId: pool.poolId,
    userId: pool.owner.id,
    ctx: asMember(pool, role, { user: pool.owner, permissions: PROBE_PERMISSIONS }),
  };
}

/** Two unrelated pools, to test that neither can see the other. */
export function createTwoPools(): { a: TestPool; b: TestPool } {
  return { a: createTestPool(), b: createTestPool() };
}

/** The Postgres error code behind a failed query (Drizzle wraps it as `cause`). */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  while (current instanceof Error) {
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = current.cause;
  }
  return undefined;
}

/** Runs a query that is expected to fail and returns its Postgres error code. */
export async function failureCodeOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    return pgErrorCode(error) ?? 'no-code';
  }
  return 'did-not-fail';
}

/** SQLSTATE codes the tests assert on. */
export const PG = {
  rlsViolation: '42501',
  invalidText: '22P02',
  numericOverflow: '22003',
} as const;
