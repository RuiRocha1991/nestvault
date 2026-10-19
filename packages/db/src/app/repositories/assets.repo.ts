import { and, asc, eq } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import { assets, type AssetRow } from '../schema/assets';

export type { AssetRow };

export interface AssetValues {
  ticker: string;
  symbol: string | null;
  name: string;
  type: string;
  currency: string;
  sector: string | null;
  region: string | null;
  dps: string | null;
  divMonths: number[];
}

/** The pool's assets. Every function filters by `ctx.poolId` (and RLS repeats it). */
export const assetsRepo = {
  async list(tx: PoolTx, ctx: PoolContext): Promise<AssetRow[]> {
    return tx
      .select()
      .from(assets)
      .where(eq(assets.poolId, ctx.poolId))
      .orderBy(asc(assets.ticker), asc(assets.id));
  },

  async find(tx: PoolTx, ctx: PoolContext, id: string): Promise<AssetRow | undefined> {
    const [row] = await tx
      .select()
      .from(assets)
      .where(and(eq(assets.poolId, ctx.poolId), eq(assets.id, id)));
    return row;
  },

  async insert(tx: PoolTx, ctx: PoolContext, id: string, data: AssetValues): Promise<AssetRow> {
    const [row] = await tx
      .insert(assets)
      .values({
        id,
        poolId: ctx.poolId,
        ticker: data.ticker,
        symbol: data.symbol,
        name: data.name,
        type: data.type,
        currency: data.currency,
        sector: data.sector,
        region: data.region,
        dps: data.dps,
        divMonths: data.divMonths,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  /** Replaces the editable fields. Returns `undefined` when the asset is not in this pool. */
  async update(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: AssetValues,
  ): Promise<AssetRow | undefined> {
    const [row] = await tx
      .update(assets)
      .set({
        ticker: data.ticker,
        symbol: data.symbol,
        name: data.name,
        type: data.type,
        currency: data.currency,
        sector: data.sector,
        region: data.region,
        dps: data.dps,
        divMonths: data.divMonths,
        updatedAt: new Date(),
      })
      .where(and(eq(assets.poolId, ctx.poolId), eq(assets.id, id)))
      .returning();
    return row;
  },

  /** Deletes the asset; its price history goes with it (cascade). */
  async remove(tx: PoolTx, ctx: PoolContext, id: string): Promise<boolean> {
    const rows = await tx
      .delete(assets)
      .where(and(eq(assets.poolId, ctx.poolId), eq(assets.id, id)))
      .returning({ id: assets.id });
    return rows.length > 0;
  },

  /**
   * How many investment operations and plans use this asset. Those tables arrive with NES-42,
   * which replaces this with the real count; until then deleting is never blocked.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the signature NES-42 fills in
  countReferences(_tx: PoolTx, _ctx: PoolContext, _id: string): Promise<number> {
    return Promise.resolve(0);
  },
};
