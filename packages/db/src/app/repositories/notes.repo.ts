import { and, asc, eq, gte, isNotNull, lte, ne, sql } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import { investmentOps } from '../schema/investments';
import { monthNotes, type MonthNoteRow } from '../schema/notes';
import { transactions } from '../schema/transactions';

export type { MonthNoteRow };

/** What a note write returns: the row id and the note's own state, never the whole row. */
export interface NoteState {
  id: string;
  note: string | null;
  noteUpdatedBy: string | null;
  noteUpdatedAt: Date | null;
}

/**
 * Notes on movements and operations. The note columns are written only here, so an import, a
 * category rule or a transfer pairing can never overwrite a note. Every function filters by
 * `ctx.poolId` (and RLS repeats it).
 */
export const notesRepo = {
  /** Sets (or, with `null`, clears) the note of a movement. `undefined` when it is not in the pool. */
  async setTransactionNote(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    note: string | null,
    userId: string | null,
    at: Date,
  ): Promise<NoteState | undefined> {
    const [row] = await tx
      .update(transactions)
      .set({ note, noteUpdatedBy: userId, noteUpdatedAt: at })
      .where(and(eq(transactions.poolId, ctx.poolId), eq(transactions.id, id)))
      .returning({
        id: transactions.id,
        note: transactions.note,
        noteUpdatedBy: transactions.noteUpdatedBy,
        noteUpdatedAt: transactions.noteUpdatedAt,
      });
    return row;
  },

  /** Same for an investment operation. */
  async setOperationNote(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    note: string | null,
    userId: string | null,
    at: Date,
  ): Promise<NoteState | undefined> {
    const [row] = await tx
      .update(investmentOps)
      .set({ note, noteUpdatedBy: userId, noteUpdatedAt: at })
      .where(and(eq(investmentOps.poolId, ctx.poolId), eq(investmentOps.id, id)))
      .returning({
        id: investmentOps.id,
        note: investmentOps.note,
        noteUpdatedBy: investmentOps.noteUpdatedBy,
        noteUpdatedAt: investmentOps.noteUpdatedAt,
      });
    return row;
  },

  /** The notes of the movements dated between two days (both included), for the monthly review. */
  async listTransactionNotes(
    tx: PoolTx,
    ctx: PoolContext,
    from: string,
    to: string,
  ): Promise<NoteState[]> {
    return tx
      .select({
        id: transactions.id,
        note: transactions.note,
        noteUpdatedBy: transactions.noteUpdatedBy,
        noteUpdatedAt: transactions.noteUpdatedAt,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.poolId, ctx.poolId),
          gte(transactions.date, from),
          lte(transactions.date, to),
          isNotNull(transactions.note),
          ne(transactions.note, ''),
        ),
      );
  },
};

/** Month notes: one per pool and month (`month` is the first day, `yyyy-mm-01`). */
export const monthNotesRepo = {
  async find(tx: PoolTx, ctx: PoolContext, month: string): Promise<MonthNoteRow | undefined> {
    const [row] = await tx
      .select()
      .from(monthNotes)
      .where(and(eq(monthNotes.poolId, ctx.poolId), eq(monthNotes.month, month)));
    return row;
  },

  /** The notes of the months between two first-of-month dates (both included), oldest first. */
  async list(tx: PoolTx, ctx: PoolContext, from: string, to: string): Promise<MonthNoteRow[]> {
    return tx
      .select()
      .from(monthNotes)
      .where(
        and(
          eq(monthNotes.poolId, ctx.poolId),
          gte(monthNotes.month, from),
          lte(monthNotes.month, to),
        ),
      )
      .orderBy(asc(monthNotes.month));
  },

  /** Creates the note; `undefined` when the month already has one (somebody was first). */
  async insert(
    tx: PoolTx,
    ctx: PoolContext,
    data: { id: string; month: string; body: string; userId: string; at: Date },
  ): Promise<MonthNoteRow | undefined> {
    const [row] = await tx
      .insert(monthNotes)
      .values({
        id: data.id,
        poolId: ctx.poolId,
        month: data.month,
        body: data.body,
        createdBy: data.userId,
        updatedBy: data.userId,
        createdAt: data.at,
        updatedAt: data.at,
      })
      .onConflictDoNothing({ target: [monthNotes.poolId, monthNotes.month] })
      .returning();
    return row;
  },

  /**
   * Replaces the body only if the stored version is still `expected` (optimistic locking). The new
   * version is always later than the old one, even inside the same millisecond. `undefined` means
   * the version moved on.
   */
  async updateIfVersion(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    expected: Date,
    data: { body: string; userId: string; at: Date },
  ): Promise<MonthNoteRow | undefined> {
    const [row] = await tx
      .update(monthNotes)
      .set({
        body: data.body,
        updatedBy: data.userId,
        updatedAt: sql`greatest(${data.at}::timestamptz, ${monthNotes.updatedAt} + interval '1 millisecond')`,
      })
      .where(
        and(
          eq(monthNotes.poolId, ctx.poolId),
          eq(monthNotes.id, id),
          eq(monthNotes.updatedAt, expected),
        ),
      )
      .returning();
    return row;
  },

  /** Deletes the note only if the stored version is still `expected`. */
  async removeIfVersion(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    expected: Date,
  ): Promise<boolean> {
    const rows = await tx
      .delete(monthNotes)
      .where(
        and(
          eq(monthNotes.poolId, ctx.poolId),
          eq(monthNotes.id, id),
          eq(monthNotes.updatedAt, expected),
        ),
      )
      .returning({ id: monthNotes.id });
    return rows.length > 0;
  },
};
