import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import { portfolioCashMoves, type PortfolioCashMoveRow } from '../schema/portfolio-cash';

export type { PortfolioCashMoveRow };

export interface PortfolioCashMoveValues {
  portfolioId: string;
  accountId: string;
  date: string;
  /** Signed, in EUR: negative takes cash out of the portfolio. */
  amount: string;
  note: string | null;
  transactionId: string | null;
  mirror: boolean;
}

/**
 * Cash moves between portfolios and bank accounts. Every function filters by `ctx.poolId` (and RLS
 * repeats it); filters are bound parameters, never part of the SQL text.
 */
export const portfolioCashMovesRepo = {
  /** Newest first; one portfolio's moves, or all of them. */
  async list(
    tx: PoolTx,
    ctx: PoolContext,
    filter: { portfolioId?: string } = {},
  ): Promise<PortfolioCashMoveRow[]> {
    return tx
      .select()
      .from(portfolioCashMoves)
      .where(
        and(
          eq(portfolioCashMoves.poolId, ctx.poolId),
          filter.portfolioId ? eq(portfolioCashMoves.portfolioId, filter.portfolioId) : undefined,
        ),
      )
      .orderBy(desc(portfolioCashMoves.date), desc(portfolioCashMoves.id));
  },

  async find(tx: PoolTx, ctx: PoolContext, id: string): Promise<PortfolioCashMoveRow | undefined> {
    const [row] = await tx
      .select()
      .from(portfolioCashMoves)
      .where(and(eq(portfolioCashMoves.poolId, ctx.poolId), eq(portfolioCashMoves.id, id)));
    return row;
  },

  /** Moves with no bank movement behind them yet, dated between two days (to match imports). */
  async listUnlinked(
    tx: PoolTx,
    ctx: PoolContext,
    from: string,
    to: string,
  ): Promise<PortfolioCashMoveRow[]> {
    return tx
      .select()
      .from(portfolioCashMoves)
      .where(
        and(
          eq(portfolioCashMoves.poolId, ctx.poolId),
          isNull(portfolioCashMoves.transactionId),
          gte(portfolioCashMoves.date, from),
          lte(portfolioCashMoves.date, to),
        ),
      );
  },

  async insert(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: PortfolioCashMoveValues,
  ): Promise<PortfolioCashMoveRow> {
    const [row] = await tx
      .insert(portfolioCashMoves)
      .values({
        id,
        poolId: ctx.poolId,
        portfolioId: data.portfolioId,
        accountId: data.accountId,
        date: data.date,
        amount: data.amount,
        note: data.note,
        transactionId: data.transactionId,
        mirror: data.mirror,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  /** Links an imported bank movement to a move that had none. `false` when there is no such move. */
  async linkTransaction(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    transactionId: string,
  ): Promise<boolean> {
    const rows = await tx
      .update(portfolioCashMoves)
      .set({ transactionId })
      .where(
        and(
          eq(portfolioCashMoves.poolId, ctx.poolId),
          eq(portfolioCashMoves.id, id),
          isNull(portfolioCashMoves.transactionId),
        ),
      )
      .returning({ id: portfolioCashMoves.id });
    return rows.length > 0;
  },

  async remove(tx: PoolTx, ctx: PoolContext, id: string): Promise<boolean> {
    const rows = await tx
      .delete(portfolioCashMoves)
      .where(and(eq(portfolioCashMoves.poolId, ctx.poolId), eq(portfolioCashMoves.id, id)))
      .returning({ id: portfolioCashMoves.id });
    return rows.length > 0;
  },

  /** Moves every move of a portfolio to another one (the portfolio is being deleted). */
  async moveAll(tx: PoolTx, ctx: PoolContext, from: string, to: string): Promise<void> {
    await tx
      .update(portfolioCashMoves)
      .set({ portfolioId: to })
      .where(
        and(eq(portfolioCashMoves.poolId, ctx.poolId), eq(portfolioCashMoves.portfolioId, from)),
      );
  },

  /** How many moves a portfolio has (deleting it needs a decision about them). */
  async count(tx: PoolTx, ctx: PoolContext, portfolioId: string): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(portfolioCashMoves)
      .where(
        and(
          eq(portfolioCashMoves.poolId, ctx.poolId),
          eq(portfolioCashMoves.portfolioId, portfolioId),
        ),
      );
    return row?.n ?? 0;
  },

  /** How many moves name this account (it cannot be deleted while any do). */
  async countByAccount(tx: PoolTx, ctx: PoolContext, accountId: string): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(portfolioCashMoves)
      .where(
        and(eq(portfolioCashMoves.poolId, ctx.poolId), eq(portfolioCashMoves.accountId, accountId)),
      );
    return row?.n ?? 0;
  },
};
