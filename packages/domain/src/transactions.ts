import { dec, type DecInput } from './decimal';

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
  interest: 'interest',
} as const;

export interface Transaction {
  id: string;
  accountId: string;
  date: string;
  /** In the account's currency; negative leaves the account. */
  amount: DecInput;
  description: string;
  /** Free text about the transaction; user content, never interpreted. */
  note?: string | null;
  categoryId?: string | null;
  /** The user chose the category: rules and detection never override it. */
  manualCategory?: boolean;
  /** Internal transfer between own accounts. */
  transfer?: boolean;
  /** The transaction on the other side of an internal transfer. */
  pairId?: string | null;
  /** The user fixed the transfer flag. */
  transferLocked?: boolean;
  /** Linked to a term deposit's interest (see `linkDepositFlows`), so it is not counted twice. */
  depositInterest?: boolean;
  /**
   * The split of the loan installment this debit paid (NES-100): only `interest` and `insurance`
   * are expenses, the `capital` is savings (equity). Amounts are positive decimal strings.
   */
  installment?: InstallmentSplit | null;
}

export interface InstallmentSplit {
  /** Interest, fees, taxes and the other expense fields. */
  interest: string;
  /** Life, home and credit insurance. */
  insurance: string;
  capital: string;
}

/** Transfer flag first, then the category's kind, then the sign (negative = expense). */
export function transactionKind(
  tx: Pick<Transaction, 'transfer' | 'categoryId' | 'amount'>,
  categories: readonly Category[],
): CategoryKind {
  return kindFromCategory(tx, indexCategoryKinds(categories));
}

/** `categoryId → kind` lookup for `kindFromCategory`. */
export const indexCategoryKinds = (
  categories: readonly Category[],
): ReadonlyMap<string, CategoryKind> => new Map(categories.map((c) => [c.id, c.kind]));

/** The kind rule on a prebuilt `categoryId → kind` lookup, for loops over many transactions. */
export function kindFromCategory(
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
