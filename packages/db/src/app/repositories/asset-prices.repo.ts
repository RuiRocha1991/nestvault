import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import { assetPrices, type AssetPriceRow } from '../schema/assets';

export type { AssetPriceRow };

export interface PriceValues {
  assetId: string;
  date: string;
  price: string;
}

export interface PriceRange {
  from?: string;
  to?: string;
  limit: number;
}

/** The price history of the pool's assets. Every function filters by `ctx.poolId` (and RLS). */
export const assetPricesRepo = {
  /** One asset's history, newest first. */
  async history(
    tx: PoolTx,
    ctx: PoolContext,
    assetId: string,
    range: PriceRange,
  ): Promise<AssetPriceRow[]> {
    return tx
      .select()
      .from(assetPrices)
      .where(
        and(
          eq(assetPrices.poolId, ctx.poolId),
          eq(assetPrices.assetId, assetId),
          range.from ? gte(assetPrices.date, range.from) : undefined,
          range.to ? lte(assetPrices.date, range.to) : undefined,
        ),
      )
      .orderBy(desc(assetPrices.date))
      .limit(range.limit);
  },

  /** For each asset of the pool, its newest price dated on or before `asOf` (`yyyy-mm-dd`). */
  async latestAsOf(tx: PoolTx, ctx: PoolContext, asOf: string): Promise<AssetPriceRow[]> {
    return tx
      .selectDistinctOn([assetPrices.assetId])
      .from(assetPrices)
      .where(and(eq(assetPrices.poolId, ctx.poolId), lte(assetPrices.date, asOf)))
      .orderBy(asc(assetPrices.assetId), desc(assetPrices.date));
  },

  /** Every price of the pool's assets dated on or after `from` (`yyyy-mm-dd`), oldest first. */
  async since(tx: PoolTx, ctx: PoolContext, from: string): Promise<AssetPriceRow[]> {
    return tx
      .select()
      .from(assetPrices)
      .where(and(eq(assetPrices.poolId, ctx.poolId), gte(assetPrices.date, from)))
      .orderBy(asc(assetPrices.date), asc(assetPrices.assetId));
  },

  /** The newest price of one asset dated on or before `asOf`, if it has any. */
  async latestFor(
    tx: PoolTx,
    ctx: PoolContext,
    assetId: string,
    asOf: string,
  ): Promise<AssetPriceRow | undefined> {
    const [row] = await tx
      .select()
      .from(assetPrices)
      .where(
        and(
          eq(assetPrices.poolId, ctx.poolId),
          eq(assetPrices.assetId, assetId),
          lte(assetPrices.date, asOf),
        ),
      )
      .orderBy(desc(assetPrices.date))
      .limit(1);
    return row;
  },

  /** Adds the price of a day or replaces it. One statement, so many rows are atomic. */
  async upsertMany(
    tx: PoolTx,
    ctx: PoolContext,
    values: readonly PriceValues[],
    source: 'manual' | 'bulk' | 'provider',
  ): Promise<void> {
    if (values.length === 0) return;
    await tx
      .insert(assetPrices)
      .values(
        values.map((value) => ({
          poolId: ctx.poolId,
          assetId: value.assetId,
          date: value.date,
          price: value.price,
          source,
        })),
      )
      .onConflictDoUpdate({
        target: [assetPrices.assetId, assetPrices.date],
        set: { price: sql`excluded.price`, source: sql`excluded.source` },
      });
  },

  async remove(tx: PoolTx, ctx: PoolContext, assetId: string, date: string): Promise<boolean> {
    const rows = await tx
      .delete(assetPrices)
      .where(
        and(
          eq(assetPrices.poolId, ctx.poolId),
          eq(assetPrices.assetId, assetId),
          eq(assetPrices.date, date),
        ),
      )
      .returning({ assetId: assetPrices.assetId });
    return rows.length > 0;
  },
};
