import { daysBetween } from './dates';
import { dec, roundCents, type Dec, type DecInput, type Money } from './decimal';
import { fx, type FxRates } from './fx';
import { byDate } from './positions';
import { findCategoryByKind, type Category, type Transaction } from './transactions';

/** A cash move that has no bank movement behind it yet, waiting for the statement line. */
export interface PendingCashMove {
  id: string;
  accountId: string;
  date: string;
  /** In EUR, signed: negative leaves the portfolio for the account. */
  amount: DecInput;
}

/** A bank movement recognised as the other side of a portfolio cash move. */
export interface CashMoveMatch {
  moveId: string;
  transactionId: string;
  /** The transfer category, so the line is not counted as income or an expense. */
  categoryId: string | null;
  /** False when the user chose the line's category by hand. */
  setCategory: boolean;
}

export interface CashMoveMatchOptions {
  /** Maximum days between the move and the bank line. */
  days?: number;
  /** Bank movements that already belong to a move (for example a mirror). */
  linked?: ReadonlySet<string>;
}

const DEFAULT_DAYS = 3;
const centsKey = (amount: Dec): string => roundCents(amount).toFixed(2);

/**
 * Cash a portfolio can still move out, or `null` when `amount` (positive, EUR) fits. Returns the
 * missing part otherwise, so the caller can say by how much the request is too large.
 */
export function cashShortfall(available: DecInput, amount: DecInput): Money | null {
  const missing = dec(amount).minus(available);
  return missing.gt(0) ? missing : null;
}

/** The amount of a move in the account's currency (the move itself is in EUR). */
export function moveAmountInAccountCurrency(
  amountEur: DecInput,
  currency: string,
  rates: FxRates,
): Money {
  return roundCents(dec(amountEur).div(fx(currency, rates)));
}

/**
 * Recognises the statement lines of moves made without a mirror: an unpaired bank movement in the
 * move's account with exactly the move's cents (an inflow for cash leaving the portfolio, an
 * outflow for cash entering it), within `days` days; the closest date wins. A move and a line are
 * used once. Only EUR accounts are matched, because the move is stored in EUR. Pure: the caller
 * persists the decisions.
 */
export function matchCashMoves(
  moves: readonly PendingCashMove[],
  transactions: readonly Transaction[],
  accounts: readonly { id: string; currency: string }[],
  categories: readonly Category[],
  options: CashMoveMatchOptions = {},
): CashMoveMatch[] {
  const days = options.days ?? DEFAULT_DAYS;
  const euroAccounts = new Set(accounts.filter((a) => a.currency === 'EUR').map((a) => a.id));
  const categoryId = findCategoryByKind(categories, 'transfer')?.id ?? null;
  const candidates = transactions.filter(
    (tx) => !tx.pairId && !tx.transferLocked && !tx.transfer && !options.linked?.has(tx.id),
  );

  const used = new Set<string>();
  const matches: CashMoveMatch[] = [];
  for (const move of [...moves].sort(byDate)) {
    if (!euroAccounts.has(move.accountId)) continue;
    const amount = dec(move.amount);
    if (amount.isZero()) continue;
    // Cash leaving the portfolio arrives in the account (positive); the other way leaves it.
    const wanted = amount.neg();
    const key = centsKey(wanted);
    let best: Transaction | null = null;
    let bestDays = days + 1;
    for (const tx of candidates) {
      if (used.has(tx.id) || tx.accountId !== move.accountId) continue;
      if (centsKey(dec(tx.amount)) !== key) continue;
      const apart = Math.abs(daysBetween(move.date, tx.date));
      if (apart <= days && apart < bestDays) {
        bestDays = apart;
        best = tx;
      }
    }
    if (!best) continue;
    used.add(best.id);
    matches.push({
      moveId: move.id,
      transactionId: best.id,
      categoryId,
      setCategory: !best.manualCategory,
    });
  }
  return matches;
}
