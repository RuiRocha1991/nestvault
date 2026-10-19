import { and, asc, eq, sql } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import { categoryRules, type CategoryRuleRow } from '../schema/transactions';

import { intArray, uuidArray } from './transactions.repo';

export type { CategoryRuleRow };

export interface RuleValues {
  keyword: string;
  categoryId: string;
  accountId: string | null;
}

/** The pool's keyword rules, in the order they are tried. Every function filters by `ctx.poolId`. */
export const categoryRulesRepo = {
  async list(tx: PoolTx, ctx: PoolContext): Promise<CategoryRuleRow[]> {
    return tx
      .select()
      .from(categoryRules)
      .where(eq(categoryRules.poolId, ctx.poolId))
      .orderBy(asc(categoryRules.position), asc(categoryRules.id));
  },

  async find(tx: PoolTx, ctx: PoolContext, id: string): Promise<CategoryRuleRow | undefined> {
    const [row] = await tx
      .select()
      .from(categoryRules)
      .where(and(eq(categoryRules.poolId, ctx.poolId), eq(categoryRules.id, id)));
    return row;
  },

  /** Adds a rule after the last one. */
  async insert(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: RuleValues,
  ): Promise<CategoryRuleRow> {
    const [last] = await tx
      .select({ position: sql<number>`coalesce(max(${categoryRules.position}), 0)::int` })
      .from(categoryRules)
      .where(eq(categoryRules.poolId, ctx.poolId));
    const [row] = await tx
      .insert(categoryRules)
      .values({
        id,
        poolId: ctx.poolId,
        keyword: data.keyword,
        categoryId: data.categoryId,
        accountId: data.accountId,
        position: (last?.position ?? 0) + 1,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  async update(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: RuleValues,
  ): Promise<CategoryRuleRow | undefined> {
    const [row] = await tx
      .update(categoryRules)
      .set({ keyword: data.keyword, categoryId: data.categoryId, accountId: data.accountId })
      .where(and(eq(categoryRules.poolId, ctx.poolId), eq(categoryRules.id, id)))
      .returning();
    return row;
  },

  async remove(tx: PoolTx, ctx: PoolContext, id: string): Promise<boolean> {
    const rows = await tx
      .delete(categoryRules)
      .where(and(eq(categoryRules.poolId, ctx.poolId), eq(categoryRules.id, id)))
      .returning({ id: categoryRules.id });
    return rows.length > 0;
  },

  /** Gives the rules the positions 1..n in the order of `ids` (all of the pool's rules). */
  async reorder(tx: PoolTx, ctx: PoolContext, ids: readonly string[]): Promise<void> {
    const positions = ids.map((_, index) => index + 1);
    await tx.execute(sql`
      update category_rules r
      set position = v.position
      from (select * from unnest(${uuidArray(ids)}, ${intArray(positions)}) as v(id, position)) v
      where r.pool_id = ${ctx.poolId} and r.id = v.id
    `);
  },
};
