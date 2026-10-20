import { and, asc, count, eq, or } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import { savingsProducts, type SavingsProductRow } from '../schema/savings';

export type { SavingsProductRow };

export interface SavingsProductValues {
  name: string;
  institution: string | null;
  rate: string;
  payN: number | null;
  payU: string | null;
  termN: number | null;
  termU: string | null;
  tax: string | null;
  payToAccountId: string | null;
  fundFromAccountId: string | null;
}

/** Savings products of the pool. Every function filters by `ctx.poolId` (and RLS repeats it). */
export const savingsProductsRepo = {
  async list(tx: PoolTx, ctx: PoolContext): Promise<SavingsProductRow[]> {
    return tx
      .select()
      .from(savingsProducts)
      .where(eq(savingsProducts.poolId, ctx.poolId))
      .orderBy(asc(savingsProducts.createdAt), asc(savingsProducts.id));
  },

  async find(tx: PoolTx, ctx: PoolContext, id: string): Promise<SavingsProductRow | undefined> {
    const [row] = await tx
      .select()
      .from(savingsProducts)
      .where(and(eq(savingsProducts.poolId, ctx.poolId), eq(savingsProducts.id, id)));
    return row;
  },

  async insert(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: SavingsProductValues,
  ): Promise<SavingsProductRow> {
    const [row] = await tx
      .insert(savingsProducts)
      .values({ id, poolId: ctx.poolId, ...fields(data) })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  /** Replaces the editable fields. Returns `undefined` when the product is not in this pool. */
  async update(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: SavingsProductValues,
  ): Promise<SavingsProductRow | undefined> {
    const [row] = await tx
      .update(savingsProducts)
      .set({ ...fields(data), updatedAt: new Date() })
      .where(and(eq(savingsProducts.poolId, ctx.poolId), eq(savingsProducts.id, id)))
      .returning();
    return row;
  },

  /** Deletes the product (the database refuses while a deposit still points at it). */
  async remove(tx: PoolTx, ctx: PoolContext, id: string): Promise<boolean> {
    const rows = await tx
      .delete(savingsProducts)
      .where(and(eq(savingsProducts.poolId, ctx.poolId), eq(savingsProducts.id, id)))
      .returning({ id: savingsProducts.id });
    return rows.length > 0;
  },

  /** How many products name this account as where interest goes or where the money comes from. */
  async countByAccount(tx: PoolTx, ctx: PoolContext, accountId: string): Promise<number> {
    const [row] = await tx
      .select({ n: count() })
      .from(savingsProducts)
      .where(
        and(
          eq(savingsProducts.poolId, ctx.poolId),
          or(
            eq(savingsProducts.payToAccountId, accountId),
            eq(savingsProducts.fundFromAccountId, accountId),
          ),
        ),
      );
    return row?.n ?? 0;
  },
};

/** The editable columns, field by field: the pool and the id never come from the caller's data. */
function fields(data: SavingsProductValues) {
  return {
    name: data.name,
    institution: data.institution,
    rate: data.rate,
    payN: data.payN,
    payU: data.payU,
    termN: data.termN,
    termU: data.termU,
    tax: data.tax,
    payToAccountId: data.payToAccountId,
    fundFromAccountId: data.fundFromAccountId,
  };
}
