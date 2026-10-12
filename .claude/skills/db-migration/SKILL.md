---
name: db-migration
description: Create or change a NestVault database table, column, index or repository with Drizzle — including Row-Level Security, the pool_id contract, money/quantity types, migrations and the isolation + SQL-injection tests. Use it whenever a task needs a new table, a schema change, a new repository function, or touches packages/db, in either nestvault_app or nestvault_identity, even if the user only says "guardar X na base de dados" or "add a field".
---

# Database migration

Two databases, never joined: `nestvault_identity` (who people are, sessions, pools, members,
invites, audit) and `nestvault_app` (money). Financial isolation between pools relies on two
independent locks — the `where pool_id = ctx.poolId` in every repository **and** RLS in Postgres —
so that a bug in one is caught by the other. This skill makes sure both locks exist for every table.

## Decide which database

- Anything about identity, authentication, membership, invites or audit → `identity`.
- Anything financial or belonging to a pool → `app`. Every such table has `pool_id`.
- Global reference data shared by all pools (only `fx_rates` today) → `app` without `pool_id`,
  read-only for `app_rw`. Adding another global table needs a reason in the PR.

## Column conventions

| Kind | Type |
| --- | --- |
| Ids | `uuid` primary key, UUID v7 generated in app code |
| Pool | `pool_id uuid not null` (first column after `id`), indexed |
| Money | `numeric(18,4)` — read as string, convert with the decimal library |
| Quantities | `numeric(20,8)` |
| Rates / percentages | `numeric(9,6)` |
| Dates | `date`; timestamps `timestamptz` |
| Enums | `text` + check constraint (or pgEnum) mirroring a zod enum |
| Names | snake_case in SQL, camelCase in TS |

Composite indexes start with `pool_id` (`(pool_id, account_id, date)`), because every query filters
on it. Foreign keys inside `app` include `pool_id` when practical so a row cannot reference another
pool's row.

## Steps

1. Edit the Drizzle schema in `packages/db/src/<db>/schema/<table>.ts` and export it from the
   folder's `index.ts`. Use the helpers in `@nestvault/db`: `money()`, `quantity()`, `rate()`,
   `poolId()` and `newId()`.
2. `pnpm db:generate:app` (or `db:generate:identity`) creates the migration SQL in
   `packages/db/migrations/<db>/`. Read the generated SQL — never edit an already-applied
   migration; add a new one. For SQL Drizzle cannot generate: `pnpm db:generate:app --custom --name=<name>`.
3. For `app` tables, add the RLS block to the same migration (Drizzle does not generate it):

```sql
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY accounts_pool_isolation ON accounts
  USING (pool_id = app_current_pool_id())
  WITH CHECK (pool_id = app_current_pool_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON accounts TO app_rw;
```

   `app_current_pool_id()` is created by the baseline migration. It returns null when the setting is
   unset **or an empty string** (what Postgres leaves behind on a reused connection), so a query
   outside `withPool` sees nothing. Never write `current_setting('app.pool_id')::uuid` directly: the
   empty string would fail the cast. `ENABLE` alone is not enough; `FORCE` makes the table owner
   obey the policy too. `app_rw` already has default privileges on tables the migration user
   creates, the explicit `GRANT` documents intent.
4. Repository in `packages/db/src/<db>/repositories/<table>.repo.ts`:

```ts
export const accountsRepo = {
  async list(tx: PoolTx, ctx: PoolContext) {
    return tx.select().from(accounts).where(eq(accounts.poolId, ctx.poolId));
  },
  async insert(tx: PoolTx, ctx: PoolContext, data: CreateAccount) {
    // Build the row field by field; poolId always from ctx, never from data.
    const [row] = await tx.insert(accounts).values({
      id: uuidv7(), poolId: ctx.poolId,
      name: data.name, type: data.type, currency: data.currency,
      openingBalance: data.openingBalance, openingDate: data.openingDate,
    }).returning();
    return row;
  },
};
```

   Rules: `PoolContext` is a required parameter; every `where` includes `pool_id`; no
   `sql.raw` / string-built SQL; any dynamic column comes from an allow-list.
5. `pnpm db:migrate` locally, then `pnpm test --project db` (the Docker Postgres must be up:
   `pnpm db:up`).

## Required tests (`tests/db/<table>.repo.test.ts`, against the Docker Postgres)

Use the harness in `tests/db/harness.ts`: `openTestDatabase()` (app connection as `app_rw` plus
`withPool`), `createTwoPools()`, `truncateAll()` in `beforeEach`, and `failureCodeOf()` / `PG` to
assert on Postgres error codes (Drizzle wraps the driver error, so match `cause.code`, not the
message). `tests/db/probe.ts` is a complete worked example of a repository and its tests.

- **Isolation (app layer):** create rows in pool A and B; with ctx A, `list`/`get`/`update`/`delete`
  never see or change B's rows. RLS would hide a missing `where pool_id`, so run this on an RLS-less
  twin table (see `makeProbeRepo` / `UNPROTECTED_PROBE_SQL` in `tests/db/`), created and dropped
  inside the test.
- **Isolation (RLS):** inside `withPool(ctxA)`, run a raw select of the table **without** the
  `pool_id` filter (test-only helper) and assert only A's rows come back; insert with
  `pool_id = B` must fail the `WITH CHECK`.
- **RLS present:** the global test in `tests/db/rls-audit.test.ts` (`findAppTablesWithoutRls`) covers
  the new table automatically — make sure it passes. A table that is global reference data goes in
  `RLS_EXEMPT_TABLES` (`packages/db/src/app/rls-audit.ts`) with a reason in the PR.
- **SQL injection:** a string field set to `' OR 1=1 --` and `'; DROP TABLE <table>; --` is stored
  and read back literally, and the table still exists.
- **Money precision:** `"0.1" + "0.2"` style values round-trip exactly as strings.

Then continue with `protected-route` if the table is exposed, and `finish-task` at the end.
