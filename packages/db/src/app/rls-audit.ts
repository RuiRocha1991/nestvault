import { sql } from 'drizzle-orm';

import type { AppDb } from './client';

/**
 * Tables of nestvault_app that are global reference data and so have no `pool_id` / RLS.
 * Adding one needs a reason in the PR (ADR 0003/0004, PRD 04). Drizzle's own bookkeeping lives in
 * the `drizzle` schema, outside `public`, and is not listed here.
 */
export const RLS_EXEMPT_TABLES: readonly string[] = [
  'fx_rates',
  'import_specs',
  'index_rates',
  'worker_pools',
];

type Queryable = Pick<AppDb, 'execute'>;

/**
 * Tables in `public` without ENABLE + FORCE ROW LEVEL SECURITY, minus the exempt ones. Partition
 * children (they follow the parent) and tables owned by an extension are not application tables.
 */
export async function findAppTablesWithoutRls(
  db: Queryable,
  exempt: readonly string[] = RLS_EXEMPT_TABLES,
): Promise<string[]> {
  const result = await db.execute<{ name: string }>(sql`
    select c.relname as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relispartition
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
      )
      and not (c.relrowsecurity and c.relforcerowsecurity)
    order by c.relname
  `);
  return result.rows.map((row) => row.name).filter((name) => !exempt.includes(name));
}

/** Throws when any pool table lacks RLS; the message lists the tables. */
export async function assertEveryAppTableHasRls(db: Queryable): Promise<void> {
  const missing = await findAppTablesWithoutRls(db);
  if (missing.length > 0) {
    throw new Error(
      `Tables without ENABLE + FORCE ROW LEVEL SECURITY: ${missing.join(', ')}. ` +
        'Add the RLS block to their migration (see the db-migration skill).',
    );
  }
}
