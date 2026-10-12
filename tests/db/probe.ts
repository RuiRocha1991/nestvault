// `_isolation_probe`: a pool table that exists only in the test database. It proves the harness:
// pool_id, FORCE RLS and the policy every real table gets from the db-migration skill.
import { and, eq } from 'drizzle-orm';
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { money, poolId, quantity } from '@nestvault/db';
import type { PoolContext, PoolTx } from '@nestvault/db';

export function defineProbeTable(name: string) {
  return pgTable(name, {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    label: text('label').notNull(),
    amount: money('amount'),
    qty: quantity('qty'),
  });
}

export type ProbeTable = ReturnType<typeof defineProbeTable>;

export const isolationProbe = defineProbeTable('_isolation_probe');

/** Same columns but NO row-level security: only the repository's pool filter protects it. */
export const unprotectedProbe = defineProbeTable('_unprotected_probe');

// Raw SQL twin of `defineProbeTable`'s columns.
const PROBE_COLUMNS_SQL = `
    id uuid PRIMARY KEY,
    pool_id uuid NOT NULL,
    label text NOT NULL,
    amount numeric(18,4),
    qty numeric(20,8)
`;

export const UNPROTECTED_PROBE_SQL = `
  CREATE TABLE _unprotected_probe (${PROBE_COLUMNS_SQL});
  GRANT SELECT, INSERT, UPDATE, DELETE ON _unprotected_probe TO app_rw;
`;

/** Applied by the harness as the migration user; real tables get this block from their migration. */
export const PROBE_TABLE_SQL = `
  CREATE TABLE _isolation_probe (${PROBE_COLUMNS_SQL});
  CREATE INDEX _isolation_probe_pool_idx ON _isolation_probe (pool_id);
  ALTER TABLE _isolation_probe ENABLE ROW LEVEL SECURITY;
  ALTER TABLE _isolation_probe FORCE ROW LEVEL SECURITY;
  CREATE POLICY _isolation_probe_pool_isolation ON _isolation_probe
    USING (pool_id = app_current_pool_id())
    WITH CHECK (pool_id = app_current_pool_id());
  GRANT SELECT, INSERT, UPDATE, DELETE ON _isolation_probe TO app_rw;
`;

export interface ProbeInput {
  id: string;
  label: string;
  amount?: string;
  qty?: string;
}

/** A repository the way the db-migration skill writes them: PoolContext required, pool from ctx. */
export function makeProbeRepo(table: ProbeTable) {
  return {
    async list(tx: PoolTx, ctx: PoolContext) {
      return tx.select().from(table).where(eq(table.poolId, ctx.poolId));
    },
    async get(tx: PoolTx, ctx: PoolContext, id: string) {
      const [row] = await tx
        .select()
        .from(table)
        .where(and(eq(table.poolId, ctx.poolId), eq(table.id, id)));
      return row;
    },
    async insert(tx: PoolTx, ctx: PoolContext, input: ProbeInput) {
      const [row] = await tx
        .insert(table)
        .values({
          id: input.id,
          poolId: ctx.poolId,
          label: input.label,
          ...(input.amount === undefined ? {} : { amount: input.amount }),
          ...(input.qty === undefined ? {} : { qty: input.qty }),
        })
        .returning();
      return row;
    },
    async update(tx: PoolTx, ctx: PoolContext, id: string, label: string) {
      return tx
        .update(table)
        .set({ label })
        .where(and(eq(table.poolId, ctx.poolId), eq(table.id, id)))
        .returning();
    },
    async remove(tx: PoolTx, ctx: PoolContext, id: string) {
      return tx
        .delete(table)
        .where(and(eq(table.poolId, ctx.poolId), eq(table.id, id)))
        .returning();
    },
  };
}

export const probeRepo = makeProbeRepo(isolationProbe);

/** Test-only helpers that deliberately skip the application-layer filter, to test RLS alone. */
export const probeUnfiltered = {
  async list(tx: PoolTx) {
    return tx.select().from(isolationProbe);
  },
  async insertForPool(tx: PoolTx, row: { id: string; poolId: string; label: string }) {
    return tx.insert(isolationProbe).values(row).returning();
  },
};
