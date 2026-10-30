import { and, asc, eq } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import { loanEvents, type LoanEventRow } from '../schema/loan-events';

export type { LoanEventRow };

export interface LoanEventValues {
  kind: string;
  date: string;
  effectiveFrom: string;
  amount: string | null;
  fee: string | null;
  effect: string | null;
  indexValue: string | null;
  spread: string | null;
  annualRate: string | null;
  newInstallment: string | null;
  termMonths: number | null;
}

/** What happened to a loan. Every function filters by `ctx.poolId` (RLS repeats it). */
export const loanEventsRepo = {
  /** The events of a loan in the order they take effect. */
  async list(tx: PoolTx, ctx: PoolContext, loanId: string): Promise<LoanEventRow[]> {
    return tx
      .select()
      .from(loanEvents)
      .where(and(eq(loanEvents.poolId, ctx.poolId), eq(loanEvents.loanId, loanId)))
      .orderBy(asc(loanEvents.effectiveFrom), asc(loanEvents.createdAt), asc(loanEvents.id));
  },

  /** The prepayments of every loan of the pool, with the date each was paid. */
  async listPrepayments(
    tx: PoolTx,
    ctx: PoolContext,
  ): Promise<{ loanId: string; date: string; amount: string }[]> {
    const rows = await tx
      .select({ loanId: loanEvents.loanId, date: loanEvents.date, amount: loanEvents.amount })
      .from(loanEvents)
      .where(and(eq(loanEvents.poolId, ctx.poolId), eq(loanEvents.kind, 'prepayment')));
    return rows.flatMap((row) => (row.amount === null ? [] : [{ ...row, amount: row.amount }]));
  },

  async find(
    tx: PoolTx,
    ctx: PoolContext,
    loanId: string,
    id: string,
  ): Promise<LoanEventRow | undefined> {
    const [row] = await tx
      .select()
      .from(loanEvents)
      .where(
        and(
          eq(loanEvents.poolId, ctx.poolId),
          eq(loanEvents.loanId, loanId),
          eq(loanEvents.id, id),
        ),
      );
    return row;
  },

  async insert(
    tx: PoolTx,
    ctx: PoolContext,
    loanId: string,
    id: string,
    data: LoanEventValues,
  ): Promise<LoanEventRow> {
    const [row] = await tx
      .insert(loanEvents)
      .values({ id, poolId: ctx.poolId, loanId, ...data })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  async remove(tx: PoolTx, ctx: PoolContext, loanId: string, id: string): Promise<boolean> {
    const rows = await tx
      .delete(loanEvents)
      .where(
        and(
          eq(loanEvents.poolId, ctx.poolId),
          eq(loanEvents.loanId, loanId),
          eq(loanEvents.id, id),
        ),
      )
      .returning({ id: loanEvents.id });
    return rows.length > 0;
  },
};
