import { and, asc, eq, or, isNull } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import { categories, type CategoryRow } from '../schema/categories';

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

  /**
   * How many transactions and rules use this category, and how many of them move to `to`. Those
   * tables arrive with NES-44, which replaces these two with the real count and the reassignment;
   * until then no category is in use.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the signature NES-44 fills in
  countReferences(_tx: PoolTx, _ctx: PoolContext, _id: string): Promise<number> {
    return Promise.resolve(0);
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the signature NES-44 fills in
  reassign(_tx: PoolTx, _ctx: PoolContext, _from: string, _to: string): Promise<void> {
    return Promise.resolve();
  },
};
