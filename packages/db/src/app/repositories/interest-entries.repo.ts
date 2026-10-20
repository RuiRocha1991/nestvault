import { and, count, desc, eq } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import { interestEntries, type InterestEntryRow } from '../schema/savings';

export type { InterestEntryRow };

export interface InterestEntryValues {
  accountId: string;
  date: string;
  amount: string;
  note: string | null;
}

/** Interest entered by hand. Every function filters by `ctx.poolId` (and RLS repeats it). */
export const interestEntriesRepo = {
  /** Newest first; narrowed to one account when given. */
  async list(tx: PoolTx, ctx: PoolContext, accountId?: string): Promise<InterestEntryRow[]> {
    return tx
      .select()
      .from(interestEntries)
      .where(
        and(
          eq(interestEntries.poolId, ctx.poolId),
          accountId ? eq(interestEntries.accountId, accountId) : undefined,
        ),
      )
      .orderBy(desc(interestEntries.date), desc(interestEntries.id));
  },

  async find(tx: PoolTx, ctx: PoolContext, id: string): Promise<InterestEntryRow | undefined> {
    const [row] = await tx
      .select()
      .from(interestEntries)
      .where(and(eq(interestEntries.poolId, ctx.poolId), eq(interestEntries.id, id)));
    return row;
  },

  async insert(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: InterestEntryValues,
  ): Promise<InterestEntryRow> {
    const [row] = await tx
      .insert(interestEntries)
      .values({
        id,
        poolId: ctx.poolId,
        accountId: data.accountId,
        date: data.date,
        amount: data.amount,
        note: data.note,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  async remove(tx: PoolTx, ctx: PoolContext, id: string): Promise<boolean> {
    const rows = await tx
      .delete(interestEntries)
      .where(and(eq(interestEntries.poolId, ctx.poolId), eq(interestEntries.id, id)))
      .returning({ id: interestEntries.id });
    return rows.length > 0;
  },

  async countByAccount(tx: PoolTx, ctx: PoolContext, accountId: string): Promise<number> {
    const [row] = await tx
      .select({ n: count() })
      .from(interestEntries)
      .where(and(eq(interestEntries.poolId, ctx.poolId), eq(interestEntries.accountId, accountId)));
    return row?.n ?? 0;
  },
};
