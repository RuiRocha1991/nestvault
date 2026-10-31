import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import { investmentOps, type InvestmentOpRow } from '../schema/investments';

export type { InvestmentOpRow };

/** A buy as the plan reminders read it. */
export interface PlanBuy {
  portfolioId: string;
  assetId: string;
  planId: string | null;
  planPeriod: string | null;
  date: string;
}

export const INVESTMENT_OP_TYPES = ['buy', 'sell', 'dividend'] as const;
export type InvestmentOpType = (typeof INVESTMENT_OP_TYPES)[number];

export interface InvestmentOpValues {
  portfolioId: string;
  assetId: string;
  accountId: string | null;
  subAccountId: string | null;
  type: InvestmentOpType;
  date: string;
  qty: string | null;
  price: string | null;
  fee: string | null;
  amount: string | null;
  gross: string | null;
  tax: string | null;
  fromCash: boolean;
  planId: string | null;
  planPeriod: string | null;
  extId: string | null;
  note: string | null;
}

export interface InvestmentOpFilter {
  portfolioId?: string;
  assetId?: string;
  accountId?: string;
  type?: InvestmentOpType;
  from?: string;
  to?: string;
  limit?: number;
}

/**
 * Buys, sells and dividends. Every function filters by `ctx.poolId` (and RLS repeats it); filters
 * are bound parameters, never part of the SQL text.
 */
export const investmentOpsRepo = {
  /** Newest first. */
  async list(
    tx: PoolTx,
    ctx: PoolContext,
    filter: InvestmentOpFilter = {},
  ): Promise<InvestmentOpRow[]> {
    const query = tx
      .select()
      .from(investmentOps)
      .where(
        and(
          eq(investmentOps.poolId, ctx.poolId),
          filter.portfolioId ? eq(investmentOps.portfolioId, filter.portfolioId) : undefined,
          filter.assetId ? eq(investmentOps.assetId, filter.assetId) : undefined,
          filter.accountId ? eq(investmentOps.accountId, filter.accountId) : undefined,
          filter.type ? eq(investmentOps.type, filter.type) : undefined,
          filter.from ? gte(investmentOps.date, filter.from) : undefined,
          filter.to ? lte(investmentOps.date, filter.to) : undefined,
        ),
      )
      .orderBy(desc(investmentOps.date), desc(investmentOps.id));
    return filter.limit ? query.limit(filter.limit) : query;
  },

  async find(tx: PoolTx, ctx: PoolContext, id: string): Promise<InvestmentOpRow | undefined> {
    const [row] = await tx
      .select()
      .from(investmentOps)
      .where(and(eq(investmentOps.poolId, ctx.poolId), eq(investmentOps.id, id)));
    return row;
  },

  /** The buys dated between two days (inclusive), as much of them as matching a plan needs. */
  async listBuysBetween(
    tx: PoolTx,
    ctx: PoolContext,
    from: string,
    to: string,
  ): Promise<PlanBuy[]> {
    return tx
      .select({
        portfolioId: investmentOps.portfolioId,
        assetId: investmentOps.assetId,
        planId: investmentOps.planId,
        planPeriod: investmentOps.planPeriod,
        date: investmentOps.date,
      })
      .from(investmentOps)
      .where(
        and(
          eq(investmentOps.poolId, ctx.poolId),
          eq(investmentOps.type, 'buy'),
          gte(investmentOps.date, from),
          lte(investmentOps.date, to),
        ),
      );
  },

  /** The buy a plan created for `period` (yyyy-mm), if it ran. */
  async findByPlanPeriod(
    tx: PoolTx,
    ctx: PoolContext,
    planId: string,
    period: string,
  ): Promise<InvestmentOpRow | undefined> {
    const [row] = await tx
      .select()
      .from(investmentOps)
      .where(
        and(
          eq(investmentOps.poolId, ctx.poolId),
          eq(investmentOps.planId, planId),
          eq(investmentOps.planPeriod, period),
        ),
      );
    return row;
  },

  async insert(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: InvestmentOpValues,
  ): Promise<InvestmentOpRow> {
    const [row] = await tx
      .insert(investmentOps)
      .values({ id, poolId: ctx.poolId, ...fields(data) })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  /**
   * Inserts an imported operation unless the account already has one with the same broker id
   * (`ON CONFLICT DO NOTHING` on the unique `(pool_id, account_id, ext_id)`), so re-importing a
   * file adds nothing and never touches what the household changed. Returns whether it was added.
   */
  async insertIgnoringExtId(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: InvestmentOpValues,
  ): Promise<boolean> {
    const rows = await tx
      .insert(investmentOps)
      .values({ id, poolId: ctx.poolId, ...fields(data) })
      .onConflictDoNothing()
      .returning({ id: investmentOps.id });
    return rows.length > 0;
  },

  /** Which of these broker ids the account already has (the import preview marks them). */
  async existingExtIds(
    tx: PoolTx,
    ctx: PoolContext,
    accountId: string,
    extIds: readonly string[],
  ): Promise<Set<string>> {
    const found = new Set<string>();
    for (let at = 0; at < extIds.length; at += 1000) {
      const rows = await tx
        .select({ extId: investmentOps.extId })
        .from(investmentOps)
        .where(
          and(
            eq(investmentOps.poolId, ctx.poolId),
            eq(investmentOps.accountId, accountId),
            inArray(investmentOps.extId, extIds.slice(at, at + 1000)),
          ),
        );
      for (const row of rows) if (row.extId !== null) found.add(row.extId);
    }
    return found;
  },

  /** Inserts many operations in chunks of 500 (prototype import); ids come from the importer. */
  async insertMany(
    tx: PoolTx,
    ctx: PoolContext,
    rows: readonly (InvestmentOpValues & { id: string })[],
  ): Promise<void> {
    for (let at = 0; at < rows.length; at += 500) {
      await tx.insert(investmentOps).values(
        rows.slice(at, at + 500).map((row) => ({
          id: row.id,
          poolId: ctx.poolId,
          ...fields(row),
        })),
      );
    }
  },

  async update(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: InvestmentOpValues,
  ): Promise<InvestmentOpRow | undefined> {
    const [row] = await tx
      .update(investmentOps)
      .set({ ...fields(data), updatedAt: new Date() })
      .where(and(eq(investmentOps.poolId, ctx.poolId), eq(investmentOps.id, id)))
      .returning();
    return row;
  },

  async remove(tx: PoolTx, ctx: PoolContext, id: string): Promise<boolean> {
    const rows = await tx
      .delete(investmentOps)
      .where(and(eq(investmentOps.poolId, ctx.poolId), eq(investmentOps.id, id)))
      .returning({ id: investmentOps.id });
    return rows.length > 0;
  },

  /** Moves every operation of a portfolio to another one; returns how many moved. */
  async moveAll(tx: PoolTx, ctx: PoolContext, from: string, to: string): Promise<number> {
    const rows = await tx
      .update(investmentOps)
      .set({ portfolioId: to, updatedAt: new Date() })
      .where(and(eq(investmentOps.poolId, ctx.poolId), eq(investmentOps.portfolioId, from)))
      .returning({ id: investmentOps.id });
    return rows.length;
  },

  /** Deletes every operation of a portfolio; returns how many went. */
  async removeAll(tx: PoolTx, ctx: PoolContext, portfolioId: string): Promise<number> {
    const rows = await tx
      .delete(investmentOps)
      .where(and(eq(investmentOps.poolId, ctx.poolId), eq(investmentOps.portfolioId, portfolioId)))
      .returning({ id: investmentOps.id });
    return rows.length;
  },

  async countByAsset(tx: PoolTx, ctx: PoolContext, assetId: string): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(investmentOps)
      .where(and(eq(investmentOps.poolId, ctx.poolId), eq(investmentOps.assetId, assetId)));
    return row?.n ?? 0;
  },

  async countByAccount(tx: PoolTx, ctx: PoolContext, accountId: string): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(investmentOps)
      .where(and(eq(investmentOps.poolId, ctx.poolId), eq(investmentOps.accountId, accountId)));
    return row?.n ?? 0;
  },

  async countBySubAccount(tx: PoolTx, ctx: PoolContext, subAccountId: string): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(investmentOps)
      .where(
        and(eq(investmentOps.poolId, ctx.poolId), eq(investmentOps.subAccountId, subAccountId)),
      );
    return row?.n ?? 0;
  },
};

/** The editable columns, field by field: the pool and the id never come from the caller's data. */
function fields(data: InvestmentOpValues) {
  return {
    portfolioId: data.portfolioId,
    assetId: data.assetId,
    accountId: data.accountId,
    subAccountId: data.subAccountId,
    type: data.type,
    date: data.date,
    qty: data.qty,
    price: data.price,
    fee: data.fee,
    amount: data.amount,
    gross: data.gross,
    tax: data.tax,
    fromCash: data.fromCash,
    planId: data.planId,
    planPeriod: data.planPeriod,
    extId: data.extId,
    note: data.note,
  };
}
