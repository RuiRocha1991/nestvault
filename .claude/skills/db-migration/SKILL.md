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

1. Edit the Drizzle schema in `packages/db/src/<db>/schema/<table>.ts`.
2. `pnpm --filter @nestvault/db db:generate:<db>` to create the migration SQL. Read the generated
   SQL — never edit an already-applied migration; add a new one.
3. For `app` tables, add the RLS block to the same migration (Drizzle does not generate it):

```sql
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY accounts_pool_isolation ON accounts
  USING (pool_id = current_setting('app.pool_id', true)::uuid)
  WITH CHECK (pool_id = current_setting('app.pool_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON accounts TO app_rw;
```

   (`current_setting(..., true)` returns null when unset, so a query outside `withPool` sees nothing.)
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
5. `pnpm db:migrate` locally and run the tests.

## Required tests (`<table>.repo.test.ts`, against the Docker Postgres)

- **Isolation (app layer):** create rows in pool A and B; with ctx A, `list`/`get`/`update`/`delete`
  never see or change B's rows.
- **Isolation (RLS):** inside `withPool(ctxA)`, run a raw select of the table **without** the
  `pool_id` filter (test-only helper) and assert only A's rows come back; insert with
  `pool_id = B` must fail the `WITH CHECK`.
- **RLS present:** the global test that every app table has `relrowsecurity` and
  `relforcerowsecurity` covers the new table automatically — make sure it passes.
- **SQL injection:** a string field set to `' OR 1=1 --` and `'; DROP TABLE <table>; --` is stored
  and read back literally, and the table still exists.
- **Money precision:** `"0.1" + "0.2"` style values round-trip exactly as strings.

Then continue with `protected-route` if the table is exposed, and `finish-task` at the end.
