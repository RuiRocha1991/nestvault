import { addMonths } from './dates';
import { dec, sum, type DecInput, type Money } from './decimal';
import { depositSchedule, isScheduled, type Deposit } from './deposits';
import { normalizeText } from './text';

export type InterestSource = 'scheduled' | 'manual' | 'statement';

export interface InterestEntry {
  id: string;
  date: string;
  /** Net amount in the account's currency. */
  amount: Money;
  source: InterestSource;
}

/** A manually entered interest (`interest_entries`). */
export interface ManualInterest {
  id: string;
  date: string;
  amount: DecInput;
}

export interface InterestCandidate {
  id: string;
  date: string;
  amount: DecInput;
  description: string;
  /** Internal transfer flag. */
  transfer?: boolean;
  /** Already counted as a deposit's interest, so it must not count twice. */
  depositInterest?: boolean;
  /** `systemKey: 'interest'` marks the global interest category; `name` is the older fallback. */
  category?: { kind: string; name?: string | null; systemKey?: string | null } | null;
}

const INTEREST_WORDS = /\b(JUROS|INTEREST)\b/;
const INTEREST_CATEGORY = /juros/i;

/** A positive, non-transfer line whose category is income "Juros", or (uncategorized) that says so. */
export function isInterestTransaction(tx: Omit<InterestCandidate, 'id' | 'date'>): boolean {
  if (dec(tx.amount).lte(0) || tx.transfer) return false;
  const { category } = tx;
  if (category) {
    const named = category.systemKey === 'interest' || INTEREST_CATEGORY.test(category.name ?? '');
    return category.kind === 'income' && named;
  }
  return INTEREST_WORDS.test(normalizeText(tx.description));
}

/**
 * Interest of an account up to `asOf`, newest first: a scheduled deposit gives its paid periods;
 * any other account gives its manual entries plus the statement lines that look like interest.
 */
export function accountInterest(
  account: {
    deposit?: Deposit | null;
    manual?: readonly ManualInterest[];
    transactions?: readonly InterestCandidate[];
  },
  asOf: string,
  defaultTax: DecInput,
): InterestEntry[] {
  const { deposit } = account;
  if (deposit && isScheduled(deposit)) {
    return depositSchedule(deposit, asOf, defaultTax)
      .filter((p) => p.date <= asOf)
      .map((p): InterestEntry => ({
        id: `${deposit.id}:${p.k}`,
        date: p.date,
        amount: p.net,
        source: 'scheduled',
      }))
      .reverse();
  }
  const manual = (account.manual ?? []).map((m): InterestEntry => ({
    id: m.id,
    date: m.date,
    amount: dec(m.amount),
    source: 'manual',
  }));
  const statement = (account.transactions ?? [])
    .filter((t) => !t.depositInterest && isInterestTransaction(t))
    .map((t): InterestEntry => ({
      id: t.id,
      date: t.date,
      amount: dec(t.amount),
      source: 'statement',
    }));
  return [...manual, ...statement].sort((a, b) => b.date.localeCompare(a.date));
}

function sumBetween(entries: readonly InterestEntry[], after: string | null, until: string): Money {
  return sum(
    entries
      .filter((e) => (after === null || e.date > after) && e.date <= until)
      .map((e) => e.amount),
  );
}

/** Interest received up to and including `asOf`. */
export const interestTotal = (entries: readonly InterestEntry[], asOf: string): Money =>
  sumBetween(entries, null, asOf);

/** Interest received in the 12 months before `asOf` (the day exactly 12 months ago is out). */
export const interestLast12Months = (entries: readonly InterestEntry[], asOf: string): Money =>
  sumBetween(entries, addMonths(asOf, -12), asOf);
