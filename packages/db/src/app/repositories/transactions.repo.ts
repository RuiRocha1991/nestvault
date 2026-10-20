import { and, asc, eq, gte, ilike, isNull, lte, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import { accounts } from '../schema/accounts';
import { categories } from '../schema/categories';
import { transactions, type TransactionRow } from '../schema/transactions';

export type { TransactionRow };

export interface TransactionValues {
  accountId: string;
  date: string;
  description: string;
  amount: string;
  categoryId: string | null;
  transfer: boolean;
  transferLocked: boolean;
  manualCategory: boolean;
  hash: string;
}

/** A movement of a prototype import (NES-47): the id is chosen by the importer, the pair is set later. */
export interface ImportedTransactionValues extends TransactionValues {
  id: string;
  /** Linked to a term deposit's interest, so it is not counted twice. */
  depositInterest: boolean;
}

/** The fields a user or the engine may change on a stored movement. */
export interface TransactionPatch {
  categoryId?: string | null;
  transfer?: boolean;
  transferLocked?: boolean;
  manualCategory?: boolean;
  pairId?: string | null;
}

export const TRANSACTION_KINDS = ['expense', 'income', 'refund', 'transfer', 'invest'] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

/** The only columns a list may be sorted by: user input picks a key, never a column name. */
export const TRANSACTION_SORTS = ['date', 'amount', 'description'] as const;
export type TransactionSort = (typeof TRANSACTION_SORTS)[number];

export interface TransactionFilter {
  /** Inclusive day range (`yyyy-mm-dd`). */
  from?: string;
  to?: string;
  accountId?: string;
  /** A category id, or `'none'` for the movements without one. */
  categoryId?: string;
  kind?: TransactionKind;
  /** Text to find in the description, matched literally (case-insensitive). */
  text?: string;
  withNotes?: boolean;
  /** Text to find in the note, matched literally (case-insensitive). */
  noteText?: string;
}

export interface TransactionCursor {
  /** The sort value of the last row of the previous page, and its id. */
  value: string;
  id: string;
}

export interface TransactionPage {
  rows: TransactionRow[];
  next: TransactionCursor | null;
}

/** `%`, `_` and `\` have a meaning in LIKE: escape them so the text is searched as typed. */
export const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/** A bound `uuid[]`: Drizzle spreads a JS array into a list, so each element is its own parameter. */
export const uuidArray = (values: readonly (string | null)[]): SQL =>
  sql`array[${sql.join(
    values.map((value) => sql`${value}::uuid`),
    sql`, `,
  )}]::uuid[]`;
export const intArray = (values: readonly number[]): SQL =>
  sql`array[${sql.join(
    values.map((value) => sql`${value}::int`),
    sql`, `,
  )}]::int[]`;

const SORT_COLUMNS = {
  date: transactions.date,
  amount: transactions.amount,
  description: transactions.description,
} as const;

/** What the engine reads to categorize and pair: no notes, no hashes. */
export interface EngineTransaction {
  id: string;
  accountId: string;
  date: string;
  amount: string;
  description: string;
  categoryId: string | null;
  manualCategory: boolean;
  transfer: boolean;
  pairId: string | null;
  transferLocked: boolean;
  /** Already counted as the interest of a deposit. */
  depositInterest: boolean;
}

const engineColumns = {
  id: transactions.id,
  accountId: transactions.accountId,
  date: transactions.date,
  amount: transactions.amount,
  description: transactions.description,
  categoryId: transactions.categoryId,
  manualCategory: transactions.manualCategory,
  transfer: transactions.transfer,
  pairId: transactions.pairId,
  transferLocked: transactions.transferLocked,
  depositInterest: transactions.depositInterest,
};

export interface EngineChange {
  id: string;
  /** New category, or `null` to leave it. */
  categoryId: string | null;
  /** New transfer flag, or `null` to leave it. */
  transfer: boolean | null;
}

/**
 * The pool's movements. Every function filters by `ctx.poolId` (and RLS repeats it); the pool of a
 * row never comes from the caller's data.
 */
export const transactionsRepo = {
  /** One page, sorted by an allow-listed column with the id as tie-break (keyset pagination). */
  async list(
    tx: PoolTx,
    ctx: PoolContext,
    filter: TransactionFilter,
    sort: { by: TransactionSort; descending: boolean },
    cursor: TransactionCursor | null,
    limit: number,
  ): Promise<TransactionPage> {
    const column = SORT_COLUMNS[sort.by];
    const kind = sql`case when ${transactions.transfer} then 'transfer' else coalesce(${categories.kind}, case when ${transactions.amount} < 0 then 'expense' else 'income' end) end`;
    const conditions: (SQL | undefined)[] = [
      eq(transactions.poolId, ctx.poolId),
      filter.from ? gte(transactions.date, filter.from) : undefined,
      filter.to ? lte(transactions.date, filter.to) : undefined,
      filter.accountId ? eq(transactions.accountId, filter.accountId) : undefined,
      filter.categoryId === 'none'
        ? isNull(transactions.categoryId)
        : filter.categoryId
          ? eq(transactions.categoryId, filter.categoryId)
          : undefined,
      filter.kind ? sql`${kind} = ${filter.kind}` : undefined,
      filter.text ? ilike(transactions.description, `%${escapeLike(filter.text)}%`) : undefined,
      filter.withNotes ? sql`coalesce(${transactions.note}, '') <> ''` : undefined,
      filter.noteText ? ilike(transactions.note, `%${escapeLike(filter.noteText)}%`) : undefined,
      cursor
        ? sort.descending
          ? sql`(${column}, ${transactions.id}) < (${cursor.value}, ${cursor.id})`
          : sql`(${column}, ${transactions.id}) > (${cursor.value}, ${cursor.id})`
        : undefined,
    ];
    // `nulls last` matches the index the table is created with (columns are not null anyway).
    const order = sort.descending
      ? [sql`${column} desc nulls last`, sql`${transactions.id} desc nulls last`]
      : [asc(column), asc(transactions.id)];
    const found = await tx
      .select({ row: transactions })
      .from(transactions)
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(and(...conditions))
      .orderBy(...order)
      .limit(limit + 1);
    const rows = found.slice(0, limit).map((entry) => entry.row);
    const last = rows.at(-1);
    return {
      rows,
      next: found.length > limit && last ? { value: last[sort.by], id: last.id } : null,
    };
  },

  async find(tx: PoolTx, ctx: PoolContext, id: string): Promise<TransactionRow | undefined> {
    const [row] = await tx
      .select()
      .from(transactions)
      .where(and(eq(transactions.poolId, ctx.poolId), eq(transactions.id, id)));
    return row;
  },

  async insert(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: TransactionValues,
  ): Promise<TransactionRow> {
    const [row] = await tx
      .insert(transactions)
      .values({
        id,
        poolId: ctx.poolId,
        accountId: data.accountId,
        date: data.date,
        description: data.description,
        amount: data.amount,
        categoryId: data.categoryId,
        transfer: data.transfer,
        transferLocked: data.transferLocked,
        manualCategory: data.manualCategory,
        hash: data.hash,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  /**
   * Inserts a movement an import found, or does nothing when the account already has its hash
   * (`ON CONFLICT DO NOTHING`). A repeated import therefore never touches the stored row: its
   * note, category and flags stay as the household left them. Returns whether a row was added.
   */
  async insertIgnoringDuplicate(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: TransactionValues,
  ): Promise<boolean> {
    const rows = await tx
      .insert(transactions)
      .values({
        id,
        poolId: ctx.poolId,
        accountId: data.accountId,
        date: data.date,
        description: data.description,
        amount: data.amount,
        categoryId: data.categoryId,
        transfer: data.transfer,
        transferLocked: data.transferLocked,
        manualCategory: data.manualCategory,
        hash: data.hash,
      })
      .onConflictDoNothing({
        target: [transactions.poolId, transactions.accountId, transactions.hash],
      })
      .returning({ id: transactions.id });
    return rows.length > 0;
  },

  /**
   * Inserts many movements in chunks of 500 (prototype import). Pairs are set afterwards with
   * `setPairs`, once both sides exist. Rows come with their own ids; the pool is always `ctx`'s.
   */
  async insertMany(
    tx: PoolTx,
    ctx: PoolContext,
    rows: readonly ImportedTransactionValues[],
  ): Promise<void> {
    for (let at = 0; at < rows.length; at += 500) {
      await tx.insert(transactions).values(
        rows.slice(at, at + 500).map((row) => ({
          id: row.id,
          poolId: ctx.poolId,
          accountId: row.accountId,
          date: row.date,
          description: row.description,
          amount: row.amount,
          categoryId: row.categoryId,
          transfer: row.transfer,
          transferLocked: row.transferLocked,
          manualCategory: row.manualCategory,
          depositInterest: row.depositInterest,
          hash: row.hash,
        })),
      );
    }
  },

  /** Links movements to the other side of their transfer, in one statement per chunk of 500. */
  async setPairs(
    tx: PoolTx,
    ctx: PoolContext,
    pairs: readonly { id: string; pairId: string }[],
  ): Promise<void> {
    for (let at = 0; at < pairs.length; at += 500) {
      const chunk = pairs.slice(at, at + 500);
      await tx.execute(sql`
        update transactions t
        set pair_id = v.pair_id
        from (
          select * from unnest(${uuidArray(chunk.map((pair) => pair.id))}, ${uuidArray(chunk.map((pair) => pair.pairId))})
            as v(id, pair_id)
        ) v
        where t.pool_id = ${ctx.poolId} and t.id = v.id
      `);
    }
  },

  /** Changes the given fields only. Returns `undefined` when the movement is not in this pool. */
  async update(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    patch: TransactionPatch,
  ): Promise<TransactionRow | undefined> {
    const [row] = await tx
      .update(transactions)
      .set({
        ...(patch.categoryId === undefined ? {} : { categoryId: patch.categoryId }),
        ...(patch.transfer === undefined ? {} : { transfer: patch.transfer }),
        ...(patch.transferLocked === undefined ? {} : { transferLocked: patch.transferLocked }),
        ...(patch.manualCategory === undefined ? {} : { manualCategory: patch.manualCategory }),
        ...(patch.pairId === undefined ? {} : { pairId: patch.pairId }),
      })
      .where(and(eq(transactions.poolId, ctx.poolId), eq(transactions.id, id)))
      .returning();
    return row;
  },

  /** Deletes a movement; the other side of a transfer must have been unpaired first. */
  async remove(tx: PoolTx, ctx: PoolContext, id: string): Promise<boolean> {
    const rows = await tx
      .delete(transactions)
      .where(and(eq(transactions.poolId, ctx.poolId), eq(transactions.id, id)))
      .returning({ id: transactions.id });
    return rows.length > 0;
  },

  /** Movements dated between two days, for the transfer detection around a new one. */
  async window(
    tx: PoolTx,
    ctx: PoolContext,
    from: string,
    to: string,
  ): Promise<EngineTransaction[]> {
    return tx
      .select(engineColumns)
      .from(transactions)
      .where(
        and(
          eq(transactions.poolId, ctx.poolId),
          gte(transactions.date, from),
          lte(transactions.date, to),
        ),
      );
  },

  /** Every movement of the pool as the engine needs it (rules applied to the existing ones). */
  async listForEngine(tx: PoolTx, ctx: PoolContext): Promise<EngineTransaction[]> {
    return tx
      .select(engineColumns)
      .from(transactions)
      .where(eq(transactions.poolId, ctx.poolId))
      .orderBy(asc(transactions.date), asc(transactions.id));
  },

  /** Marks two movements as the sides of a transfer; a side with a manual category keeps it. */
  async pair(
    tx: PoolTx,
    ctx: PoolContext,
    pair: {
      outflowId: string;
      inflowId: string;
      categoryId: string | null;
      setOutflowCategory: boolean;
      setInflowCategory: boolean;
    },
  ): Promise<void> {
    const side = async (id: string, partner: string, setCategory: boolean) => {
      await tx
        .update(transactions)
        .set({
          transfer: true,
          pairId: partner,
          ...(setCategory && pair.categoryId ? { categoryId: pair.categoryId } : {}),
        })
        .where(and(eq(transactions.poolId, ctx.poolId), eq(transactions.id, id)));
    };
    await side(pair.outflowId, pair.inflowId, pair.setOutflowCategory);
    await side(pair.inflowId, pair.outflowId, pair.setInflowCategory);
  },

  /** The partner of a transfer, so a deleted side can release it. */
  async unpairPartner(tx: PoolTx, ctx: PoolContext, id: string): Promise<void> {
    await tx
      .update(transactions)
      .set({ pairId: null })
      .where(and(eq(transactions.poolId, ctx.poolId), eq(transactions.pairId, id)));
  },

  /** Applies what the rules decided, in one statement per chunk. */
  async applyChanges(
    tx: PoolTx,
    ctx: PoolContext,
    changes: readonly EngineChange[],
  ): Promise<number> {
    let updated = 0;
    for (let at = 0; at < changes.length; at += 500) {
      const chunk = changes.slice(at, at + 500);
      const ids = chunk.map((change) => change.id);
      const categoryIds = chunk.map((change) => change.categoryId);
      // -1 leaves the flag alone, 0 clears it, 1 sets it.
      const transfers = chunk.map((change) =>
        change.transfer === null ? -1 : change.transfer ? 1 : 0,
      );
      const result = await tx.execute(sql`
        update transactions t
        set category_id = coalesce(v.category_id, t.category_id),
            is_transfer = case v.flag when 1 then true when 0 then false else t.is_transfer end
        from (
          select * from unnest(${uuidArray(ids)}, ${uuidArray(categoryIds)}, ${intArray(transfers)})
            as v(id, category_id, flag)
        ) v
        where t.pool_id = ${ctx.poolId} and t.id = v.id
      `);
      updated += result.rowCount ?? 0;
    }
    return updated;
  },

  /** Whether the accounts exist in the pool (a movement is written only into its own pool's account). */
  async accountExists(tx: PoolTx, ctx: PoolContext, accountId: string): Promise<boolean> {
    const rows = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.poolId, ctx.poolId), eq(accounts.id, accountId)));
    return rows.length > 0;
  },
};
