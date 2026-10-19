import { eq } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import { poolSettings, type PoolSettingsRow } from '../schema/pool-settings';

export type { PoolSettingsRow };

export interface PoolSettingsValues {
  transferWindowDays: number;
  depositTax: string;
  dividendTax: string;
  displayCurrency: string;
  fxOverrides: Record<string, string>;
}

/** One row per pool. Every function filters by `ctx.poolId` (and RLS repeats it). */
export const poolSettingsRepo = {
  async find(tx: PoolTx, ctx: PoolContext): Promise<PoolSettingsRow | undefined> {
    const [row] = await tx.select().from(poolSettings).where(eq(poolSettings.poolId, ctx.poolId));
    return row;
  },

  /** Creates the pool's row or replaces its values; the pool always comes from `ctx`. */
  async upsert(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    values: PoolSettingsValues,
    updatedBy: string | null,
  ): Promise<PoolSettingsRow> {
    const fields = {
      transferWindowDays: values.transferWindowDays,
      depositTax: values.depositTax,
      dividendTax: values.dividendTax,
      displayCurrency: values.displayCurrency,
      fxOverrides: values.fxOverrides,
      updatedBy,
      updatedAt: new Date(),
    };
    const [row] = await tx
      .insert(poolSettings)
      .values({ id, poolId: ctx.poolId, ...fields })
      .onConflictDoUpdate({ target: poolSettings.poolId, set: fields })
      .returning();
    if (!row) throw new Error('upsert returned no row');
    return row;
  },
};
