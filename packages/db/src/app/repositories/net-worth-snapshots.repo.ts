import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import { netWorthSnapshots, type NetWorthSnapshotRow } from '../schema/net-worth-snapshots';

export type { NetWorthSnapshotRow };

export interface SnapshotValues {
  date: string;
  net: string;
  cash: string;
  savings: string;
  investments: string;
  byCcy: Record<string, string>;
}

/** Daily net worth of a pool. Every function filters by `ctx.poolId` (and RLS repeats it). */
export const netWorthSnapshotsRepo = {
  /** Creates the day's row or replaces it; the pool always comes from `ctx`. */
  async upsertMany(tx: PoolTx, ctx: PoolContext, rows: readonly SnapshotValues[]): Promise<void> {
    if (rows.length === 0) return;
    for (const row of rows) {
      const fields = {
        net: row.net,
        cash: row.cash,
        savings: row.savings,
        investments: row.investments,
        byCcy: row.byCcy,
        createdAt: new Date(),
      };
      await tx
        .insert(netWorthSnapshots)
        .values({ poolId: ctx.poolId, date: row.date, ...fields })
        .onConflictDoUpdate({
          target: [netWorthSnapshots.poolId, netWorthSnapshots.date],
          set: fields,
        });
    }
  },

  /** The rows stored for exactly these dates. */
  async listForDates(
    tx: PoolTx,
    ctx: PoolContext,
    dates: readonly string[],
  ): Promise<NetWorthSnapshotRow[]> {
    if (dates.length === 0) return [];
    return tx
      .select()
      .from(netWorthSnapshots)
      .where(
        and(eq(netWorthSnapshots.poolId, ctx.poolId), inArray(netWorthSnapshots.date, [...dates])),
      );
  },

  /** The rows between two dates (inclusive), oldest first. */
  async listBetween(
    tx: PoolTx,
    ctx: PoolContext,
    from: string,
    to: string,
  ): Promise<NetWorthSnapshotRow[]> {
    return tx
      .select()
      .from(netWorthSnapshots)
      .where(
        and(
          eq(netWorthSnapshots.poolId, ctx.poolId),
          gte(netWorthSnapshots.date, from),
          lte(netWorthSnapshots.date, to),
        ),
      )
      .orderBy(asc(netWorthSnapshots.date));
  },
};
