import { and, asc, eq } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import { poolCategorySettings, type CategorySettingsRow } from '../schema/categories';

export type { CategorySettingsRow };

export interface CategorySettingsValues {
  monthlyBudget: string | null;
  colorOverride: string | null;
  hidden: boolean;
}

/** What this pool decided about categories. Every function filters by `ctx.poolId` (and RLS). */
export const categorySettingsRepo = {
  async list(tx: PoolTx, ctx: PoolContext): Promise<CategorySettingsRow[]> {
    return tx
      .select()
      .from(poolCategorySettings)
      .where(eq(poolCategorySettings.poolId, ctx.poolId))
      .orderBy(asc(poolCategorySettings.categoryId));
  },

  async find(
    tx: PoolTx,
    ctx: PoolContext,
    categoryId: string,
  ): Promise<CategorySettingsRow | undefined> {
    const [row] = await tx
      .select()
      .from(poolCategorySettings)
      .where(
        and(
          eq(poolCategorySettings.poolId, ctx.poolId),
          eq(poolCategorySettings.categoryId, categoryId),
        ),
      );
    return row;
  },

  /** Creates the pool's row for the category or replaces its values; the pool comes from `ctx`. */
  async upsert(
    tx: PoolTx,
    ctx: PoolContext,
    categoryId: string,
    values: CategorySettingsValues,
  ): Promise<CategorySettingsRow> {
    const fields = {
      monthlyBudget: values.monthlyBudget,
      colorOverride: values.colorOverride,
      hidden: values.hidden,
      updatedAt: new Date(),
    };
    const [row] = await tx
      .insert(poolCategorySettings)
      .values({ poolId: ctx.poolId, categoryId, ...fields })
      .onConflictDoUpdate({
        target: [poolCategorySettings.poolId, poolCategorySettings.categoryId],
        set: fields,
      })
      .returning();
    if (!row) throw new Error('upsert returned no row');
    return row;
  },
};
