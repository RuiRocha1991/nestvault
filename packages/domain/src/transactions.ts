import { monthKey } from './dates';
import { dec, type Dec, type DecInput, type Money } from './decimal';
import { toEur, type FxRates } from './fx';

export type CategoryKind = 'expense' | 'income' | 'refund' | 'transfer' | 'invest';

/**
 * A category as the rules need it. Logic uses `kind` and the stable `systemKey` of global
 * categories (ADR 0004); display names come from i18n and are never matched.
 */
export interface Category {
  id: string;
  kind: CategoryKind;
  systemKey?: string | null;
}

/** `systemKey` values of global categories the engine looks up. */
export const SYSTEM_KEYS = {
  externalTransfers: 'external-transfers',
  otherExpenses: 'other-expenses',
} as const;

export interface Transaction {
  id: string;
  accountId: string;
  date: string;
  /** In the account's currency; negative leaves the account. */
  amount: DecInput;
  description: string;
  categoryId?: string | null;
  /** The user chose the category: rules and detection never override it. */
  manualCategory?: boolean;
  /** Internal transfer between own accounts. */
  transfer?: boolean;
  /** The transaction on the other side of an internal transfer. */
  pairId?: string | null;
  /** The user fixed the transfer flag. */
  transferLocked?: boolean;
}

/** Transfer flag first, then the category's kind, then the sign (negative = expense). */
export function transactionKind(
  tx: Pick<Transaction, 'transfer' | 'categoryId' | 'amount'>,
  categories: readonly Category[],
): CategoryKind {
  return kindFromCategory(tx, new Map(categories.map((c) => [c.id, c.kind])));
}

/** The kind rule on a prebuilt `categoryId → kind` lookup, for loops over many transactions. */
function kindFromCategory(
  tx: Pick<Transaction, 'transfer' | 'categoryId' | 'amount'>,
  kindById: ReadonlyMap<string, CategoryKind>,
): CategoryKind {
  if (tx.transfer) return 'transfer';
  return (tx.categoryId ? kindById.get(tx.categoryId) : undefined) ?? signKind(tx.amount);
}

const signKind = (amount: DecInput): CategoryKind => (dec(amount).isNeg() ? 'expense' : 'income');

export function findCategoryByKind(
  categories: readonly Category[],
  kind: CategoryKind,
): Category | undefined {
  return categories.find((c) => c.kind === kind);
}

export function findCategoryBySystemKey(
  categories: readonly Category[],
  systemKey: string,
): Category | undefined {
  return categories.find((c) => c.systemKey === systemKey);
}

export interface AccountCurrency {
  id: string;
  currency: string;
}

export interface MonthExpenses {
  /** Expenses minus refunds, positive, in EUR. Transfers and investments are not expenses. */
  expenses: Money;
  refunds: Money;
}

/**
 * Expenses of a `yyyy-mm` month in EUR: expense-kind transactions minus refunds (a refund reduces
 * the month's expenses). Internal transfers are excluded because their kind is `transfer`.
 */
export function monthExpenses(
  transactions: readonly Transaction[],
  categories: readonly Category[],
  accounts: readonly AccountCurrency[],
  rates: FxRates,
  month: string,
): MonthExpenses {
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency]));
  const kindById = new Map(categories.map((c) => [c.id, c.kind]));
  let expenses: Dec = dec(0);
  let refunds: Dec = dec(0);
  for (const t of transactions) {
    if (monthKey(t.date) !== month) continue;
    const kind = kindFromCategory(t, kindById);
    if (kind === 'expense')
      expenses = expenses.plus(toEur(t.amount, currencyOf.get(t.accountId), rates));
    else if (kind === 'refund')
      refunds = refunds.plus(toEur(t.amount, currencyOf.get(t.accountId), rates));
  }
  return { expenses: expenses.neg().minus(refunds), refunds };
}
