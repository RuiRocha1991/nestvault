import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import { categories, type CategoryRow } from '../schema/categories';
import { categoryRules, transactions } from '../schema/transactions';

export type { CategoryRow };

export interface CategoryValues {
  name: string;
  kind: string;
  color: string;
}

/**
 * The categories a pool sees: the global catalogue plus its own. Reads filter by
 * `pool_id is null or pool_id = ctx.poolId` (and RLS repeats it); writes touch the pool's own rows
 * only, so a global row can never be changed or removed through a pool context.
 */
export const categoriesRepo = {
  async list(tx: PoolTx, ctx: PoolContext): Promise<CategoryRow[]> {
    return tx
      .select()
      .from(categories)
      .where(or(isNull(categories.poolId), eq(categories.poolId, ctx.poolId)))
      .orderBy(asc(categories.createdAt), asc(categories.id));
  },

  /** A global category or one of this pool; `undefined` for another pool's. */
  async find(tx: PoolTx, ctx: PoolContext, id: string): Promise<CategoryRow | undefined> {
    const [row] = await tx
      .select()
      .from(categories)
      .where(
        and(
          eq(categories.id, id),
          or(isNull(categories.poolId), eq(categories.poolId, ctx.poolId)),
        ),
      );
    return row;
  },

  async insert(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: CategoryValues,
  ): Promise<CategoryRow> {
    const [row] = await tx
      .insert(categories)
      .values({ id, poolId: ctx.poolId, name: data.name, kind: data.kind, color: data.color })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  /** Changes one of this pool's own categories; `undefined` for a global or foreign one. */
  async update(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: CategoryValues,
  ): Promise<CategoryRow | undefined> {
    const [row] = await tx
      .update(categories)
      .set({ name: data.name, kind: data.kind, color: data.color, updatedAt: new Date() })
      .where(and(eq(categories.poolId, ctx.poolId), eq(categories.id, id)))
      .returning();
    return row;
  },

  /** Deletes one of this pool's own categories; false for a global or foreign one. */
  async remove(tx: PoolTx, ctx: PoolContext, id: string): Promise<boolean> {
    const rows = await tx
      .delete(categories)
      .where(and(eq(categories.poolId, ctx.poolId), eq(categories.id, id)))
      .returning({ id: categories.id });
    return rows.length > 0;
  },

  /** How many transactions and rules of this pool use the category. */
  async countReferences(tx: PoolTx, ctx: PoolContext, id: string): Promise<number> {
    const [moved, ruled] = await Promise.all([
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(transactions)
        .where(and(eq(transactions.poolId, ctx.poolId), eq(transactions.categoryId, id))),
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(categoryRules)
        .where(and(eq(categoryRules.poolId, ctx.poolId), eq(categoryRules.categoryId, id))),
    ]);
    return (moved[0]?.n ?? 0) + (ruled[0]?.n ?? 0);
  },

  /** Moves the pool's transactions and rules from one category to another. */
  async reassign(tx: PoolTx, ctx: PoolContext, from: string, to: string): Promise<void> {
    await tx
      .update(transactions)
      .set({ categoryId: to })
      .where(and(eq(transactions.poolId, ctx.poolId), eq(transactions.categoryId, from)));
    await tx
      .update(categoryRules)
      .set({ categoryId: to })
      .where(and(eq(categoryRules.poolId, ctx.poolId), eq(categoryRules.categoryId, from)));
  },
};
