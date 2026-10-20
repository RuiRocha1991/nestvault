import { and, asc, eq, sql, type SQL } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import { plans, type PlanRow } from '../schema/investments';

export type { PlanRow };

export interface PlanValues {
  portfolioId: string;
  assetId: string;
  accountId: string | null;
  subAccountId: string | null;
  amount: string;
  day: number;
  active: boolean;
}

/** Regular investment plans. Every function filters by `ctx.poolId` (and RLS repeats it). */
export const plansRepo = {
  async list(tx: PoolTx, ctx: PoolContext, portfolioId?: string): Promise<PlanRow[]> {
    return tx
      .select()
      .from(plans)
      .where(
        and(
          eq(plans.poolId, ctx.poolId),
          portfolioId ? eq(plans.portfolioId, portfolioId) : undefined,
        ),
      )
      .orderBy(asc(plans.createdAt), asc(plans.id));
  },

  async find(tx: PoolTx, ctx: PoolContext, id: string): Promise<PlanRow | undefined> {
    const [row] = await tx
      .select()
      .from(plans)
      .where(and(eq(plans.poolId, ctx.poolId), eq(plans.id, id)));
    return row;
  },

  async insert(tx: PoolTx, ctx: PoolContext, id: string, data: PlanValues): Promise<PlanRow> {
    const [row] = await tx
      .insert(plans)
      .values({
        id,
        poolId: ctx.poolId,
        portfolioId: data.portfolioId,
        assetId: data.assetId,
        accountId: data.accountId,
        subAccountId: data.subAccountId,
        amount: data.amount,
        day: data.day,
        active: data.active,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  async update(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: PlanValues,
  ): Promise<PlanRow | undefined> {
    const [row] = await tx
      .update(plans)
      .set({
        portfolioId: data.portfolioId,
        assetId: data.assetId,
        accountId: data.accountId,
        subAccountId: data.subAccountId,
        amount: data.amount,
        day: data.day,
        active: data.active,
        updatedAt: new Date(),
      })
      .where(and(eq(plans.poolId, ctx.poolId), eq(plans.id, id)))
      .returning();
    return row;
  },

  /** Moves every plan of a portfolio to another one; returns how many moved. */
  async moveAll(tx: PoolTx, ctx: PoolContext, from: string, to: string): Promise<number> {
    const rows = await tx
      .update(plans)
      .set({ portfolioId: to, updatedAt: new Date() })
      .where(and(eq(plans.poolId, ctx.poolId), eq(plans.portfolioId, from)))
      .returning({ id: plans.id });
    return rows.length;
  },

  /** Deletes every plan of a portfolio; the buys they created stay, without the link. */
  async removeAll(tx: PoolTx, ctx: PoolContext, portfolioId: string): Promise<number> {
    const rows = await tx
      .delete(plans)
      .where(and(eq(plans.poolId, ctx.poolId), eq(plans.portfolioId, portfolioId)))
      .returning({ id: plans.id });
    return rows.length;
  },

  countByPortfolio: (tx: PoolTx, ctx: PoolContext, portfolioId: string) =>
    countWhere(tx, ctx, eq(plans.portfolioId, portfolioId)),
  countByAsset: (tx: PoolTx, ctx: PoolContext, assetId: string) =>
    countWhere(tx, ctx, eq(plans.assetId, assetId)),
  countByAccount: (tx: PoolTx, ctx: PoolContext, accountId: string) =>
    countWhere(tx, ctx, eq(plans.accountId, accountId)),
  countBySubAccount: (tx: PoolTx, ctx: PoolContext, subAccountId: string) =>
    countWhere(tx, ctx, eq(plans.subAccountId, subAccountId)),

  /** Deletes the plan; the buys it created stay, without the link. */
  async remove(tx: PoolTx, ctx: PoolContext, id: string): Promise<boolean> {
    const rows = await tx
      .delete(plans)
      .where(and(eq(plans.poolId, ctx.poolId), eq(plans.id, id)))
      .returning({ id: plans.id });
    return rows.length > 0;
  },
};

async function countWhere(tx: PoolTx, ctx: PoolContext, filter: SQL): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(plans)
    .where(and(eq(plans.poolId, ctx.poolId), filter));
  return row?.n ?? 0;
}
