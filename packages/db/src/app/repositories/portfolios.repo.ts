import { and, asc, eq, sql } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import { investmentOps, plans } from '../schema/investments';
import { portfolios, type PortfolioRow } from '../schema/portfolios';

export type { PortfolioRow };

export interface PortfolioWithCounts {
  row: PortfolioRow;
  opsCount: number;
  plansCount: number;
}

export interface PortfolioValues {
  name: string;
  color: string;
  currency: string;
  note: string | null;
  targets: Record<string, unknown>;
}

/**
 * Portfolios of the pool. Every function filters by `ctx.poolId` (and RLS repeats it); the pool of
 * a row never comes from the caller's data.
 */
export const portfoliosRepo = {
  async list(tx: PoolTx, ctx: PoolContext): Promise<PortfolioRow[]> {
    return tx
      .select()
      .from(portfolios)
      .where(eq(portfolios.poolId, ctx.poolId))
      .orderBy(asc(portfolios.createdAt), asc(portfolios.id));
  },

  async find(tx: PoolTx, ctx: PoolContext, id: string): Promise<PortfolioRow | undefined> {
    const [row] = await tx
      .select()
      .from(portfolios)
      .where(and(eq(portfolios.poolId, ctx.poolId), eq(portfolios.id, id)));
    return row;
  },

  /** Every portfolio with the number of operations and plans in it, in three queries. */
  async listWithCounts(tx: PoolTx, ctx: PoolContext): Promise<PortfolioWithCounts[]> {
    const [rows, ops, planCounts] = await Promise.all([
      portfoliosRepo.list(tx, ctx),
      tx
        .select({ id: investmentOps.portfolioId, n: sql<number>`count(*)::int` })
        .from(investmentOps)
        .where(eq(investmentOps.poolId, ctx.poolId))
        .groupBy(investmentOps.portfolioId),
      tx
        .select({ id: plans.portfolioId, n: sql<number>`count(*)::int` })
        .from(plans)
        .where(eq(plans.poolId, ctx.poolId))
        .groupBy(plans.portfolioId),
    ]);
    const opsById = new Map(ops.map((count) => [count.id, count.n]));
    const plansById = new Map(planCounts.map((count) => [count.id, count.n]));
    return rows.map((row) => ({
      row,
      opsCount: opsById.get(row.id) ?? 0,
      plansCount: plansById.get(row.id) ?? 0,
    }));
  },

  async insert(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: PortfolioValues,
  ): Promise<PortfolioRow> {
    const [row] = await tx
      .insert(portfolios)
      .values({
        id,
        poolId: ctx.poolId,
        name: data.name,
        color: data.color,
        currency: data.currency,
        note: data.note,
        targets: data.targets,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  /** Replaces the editable fields. Returns `undefined` when the portfolio is not in this pool. */
  async update(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: PortfolioValues,
  ): Promise<PortfolioRow | undefined> {
    const [row] = await tx
      .update(portfolios)
      .set({
        name: data.name,
        color: data.color,
        currency: data.currency,
        note: data.note,
        targets: data.targets,
        updatedAt: new Date(),
      })
      .where(and(eq(portfolios.poolId, ctx.poolId), eq(portfolios.id, id)))
      .returning();
    return row;
  },

  /** Deletes the portfolio; its plans go with it (cascade), accounts linked to it are unlinked. */
  async remove(tx: PoolTx, ctx: PoolContext, id: string): Promise<boolean> {
    const rows = await tx
      .delete(portfolios)
      .where(and(eq(portfolios.poolId, ctx.poolId), eq(portfolios.id, id)))
      .returning({ id: portfolios.id });
    return rows.length > 0;
  },

  /** How many plans are in this portfolio (deleting it needs a decision about them). */
  async countPlans(tx: PoolTx, ctx: PoolContext, id: string): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(plans)
      .where(and(eq(plans.poolId, ctx.poolId), eq(plans.portfolioId, id)));
    return row?.n ?? 0;
  },

  /** How many operations are in this portfolio (the service refuses to delete it while any). */
  async countOps(tx: PoolTx, ctx: PoolContext, id: string): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(investmentOps)
      .where(and(eq(investmentOps.poolId, ctx.poolId), eq(investmentOps.portfolioId, id)));
    return row?.n ?? 0;
  },
};
