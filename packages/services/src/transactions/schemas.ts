import { TRANSACTION_KINDS, TRANSACTION_SORTS } from '@nestvault/db';
import type { TransactionCursor, TransactionRow } from '@nestvault/db';
import { suggestKeyword, toPlain, transactionKind, type Category } from '@nestvault/domain';
import { z } from 'zod';

export const TRANSACTIONS_PAGE_DEFAULT = 50;
export const TRANSACTIONS_PAGE_MAX = 200;

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const NO_CONTROL = /^[^\u0000-\u001f\u007f]+$/;
const Description = z.string().trim().min(1).max(500).regex(NO_CONTROL);
/** A signed amount in the account's currency: a decimal string with up to 4 decimals, not zero. */
const AMOUNT = /^-?\d{1,14}(\.\d{1,4})?$/;
const Amount = z.string().refine((value) => AMOUNT.test(value) && !/^-?0+(\.0+)?$/.test(value));

/**
 * Only client-editable fields (`.strict()`: `poolId`, `id`, `hash`, `pairId` and the rest answer
 * 400). Without a `categoryId` the household's rules choose one; with one, it counts as chosen by
 * hand and no rule overrides it.
 */
export const CreateTransactionInput = z
  .object({
    accountId: z.uuid(),
    date: z.iso.date(),
    description: Description,
    amount: Amount,
    categoryId: z.uuid().nullable().optional(),
  })
  .strict();
export type CreateTransactionInput = z.input<typeof CreateTransactionInput>;

/**
 * `categoryId` sets the category by hand (`null` hands it back to the rules); `transfer` fixes the
 * internal-transfer flag, which detection then leaves alone. At least one is needed.
 */
export const UpdateTransactionInput = z
  .object({ categoryId: z.uuid().nullable(), transfer: z.boolean() })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export type UpdateTransactionInput = z.input<typeof UpdateTransactionInput>;

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Flag = z.enum(['true', 'false']).transform((value) => value === 'true');

/** The query string of the list: filters, an allow-listed sort and a keyset cursor. */
export const ListTransactionsQuery = z
  .object({
    month: Month.optional(),
    accountId: z.uuid().optional(),
    categoryId: z.union([z.uuid(), z.literal('none')]).optional(),
    kind: z.enum(TRANSACTION_KINDS).optional(),
    q: z.string().trim().min(1).max(100).regex(NO_CONTROL).optional(),
    withNotes: Flag.optional(),
    /** Text to find in the notes, matched literally. */
    noteQ: z.string().trim().min(1).max(100).regex(NO_CONTROL).optional(),
    sort: z.enum(TRANSACTION_SORTS).default('date'),
    order: z.enum(['asc', 'desc']).default('desc'),
    cursor: z.string().max(600).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(TRANSACTIONS_PAGE_MAX)
      .default(TRANSACTIONS_PAGE_DEFAULT),
  })
  .strict();
export type ListTransactionsQuery = z.input<typeof ListTransactionsQuery>;

export const TransactionDto = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  date: z.iso.date(),
  description: z.string(),
  /** Signed, in the account's currency, a decimal string. */
  amount: z.string(),
  categoryId: z.uuid().nullable(),
  /** The kind that counts: transfer flag first, then the category, then the sign. */
  kind: z.enum(TRANSACTION_KINDS),
  transfer: z.boolean(),
  pairId: z.uuid().nullable(),
  transferLocked: z.boolean(),
  manualCategory: z.boolean(),
  depositInterest: z.boolean(),
  note: z.string().nullable(),
  /** Who last wrote the note and when (for the note editor); null while there is no note. */
  noteUpdatedBy: z.uuid().nullable(),
  noteUpdatedAt: z.iso.datetime().nullable(),
  /** What a rule made from this movement would look for: its IBAN when it has one; may be empty. */
  suggestedKeyword: z.string(),
});
export type TransactionDto = z.infer<typeof TransactionDto>;

export const TransactionPageDto = z.object({
  transactions: z.array(TransactionDto),
  /** Pass it as `cursor` for the next page; null on the last one. */
  nextCursor: z.string().nullable(),
});
export type TransactionPageDto = z.infer<typeof TransactionPageDto>;

export const toTransactionDto = (
  row: TransactionRow,
  categories: readonly Category[],
): TransactionDto => ({
  id: row.id,
  accountId: row.accountId,
  date: row.date,
  description: row.description,
  amount: toPlain(row.amount),
  categoryId: row.categoryId,
  kind: transactionKind(row, categories),
  transfer: row.transfer,
  pairId: row.pairId,
  transferLocked: row.transferLocked,
  manualCategory: row.manualCategory,
  depositInterest: row.depositInterest,
  note: row.note,
  noteUpdatedBy: row.noteUpdatedBy,
  noteUpdatedAt: row.noteUpdatedAt ? row.noteUpdatedAt.toISOString() : null,
  suggestedKeyword: suggestKeyword(row.description),
});

/** A cursor names the sort it belongs to, so a cursor of another sort answers 400, not an SQL error. */
export interface CursorState extends TransactionCursor {
  sort: (typeof TRANSACTION_SORTS)[number];
  order: 'asc' | 'desc';
}

const CursorBody = z
  .object({
    s: z.enum(TRANSACTION_SORTS),
    o: z.enum(['asc', 'desc']),
    v: z.string().max(500),
    i: z.uuid(),
  })
  .strict();

const CURSOR_VALUE = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  amount: AMOUNT,
  description: /^[\s\S]{1,500}$/,
} as const;

export function encodeCursor(state: CursorState): string {
  return Buffer.from(
    JSON.stringify({ s: state.sort, o: state.order, v: state.value, i: state.id }),
  ).toString('base64url');
}

/** `null` when the cursor is malformed or belongs to another sort. */
export function decodeCursor(
  text: string,
  sort: CursorState['sort'],
  order: CursorState['order'],
): TransactionCursor | null {
  try {
    const parsed = CursorBody.safeParse(
      JSON.parse(Buffer.from(text, 'base64url').toString('utf8')),
    );
    if (!parsed.success) return null;
    const { s, o, v, i } = parsed.data;
    if (s !== sort || o !== order || !CURSOR_VALUE[s].test(v)) return null;
    return { value: v, id: i.toLowerCase() };
  } catch {
    return null;
  }
}

/** The first and last day of `yyyy-mm`. */
export function monthRange(month: string): { from: string; to: string } {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}
