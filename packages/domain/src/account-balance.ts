import { dec, sum, type Dec, type DecInput, type Money } from './decimal';
import { depositFlows, depositValue, type Deposit } from './deposits';
import { fx, type FxRates } from './fx';
import type { ManualInterest } from './interest';
import type { PortfolioCashMove } from './portfolio-cash';
import {
  byDate,
  cashEffect,
  cashEffectNative,
  indexAssets,
  type InvestmentAsset,
  type InvestmentOp,
} from './positions';
import type { Category, Transaction } from './transactions';

/** `term` deposits and `savings` accounts count as savings; everything else is cash. */
export type AccountKind = 'term' | 'savings' | 'other';

export interface LedgerAccount {
  id: string;
  /** A term deposit is always EUR. */
  currency: string;
  kind: AccountKind;
  isBrokerage?: boolean;
  /** `false` when the balance does not follow the account's investment operations. */
  trackCash?: boolean;
  opening?: DecInput | null;
  /** The opening balance counts from this date; missing means always. */
  openingDate?: string | null;
  /** The deposit behind a `term` account (its `id` is the account id). */
  deposit?: Deposit | null;
  /** Portfolio the account is linked to; it is still counted once in net worth. */
  portfolioId?: string | null;
}

export interface ManualInterestEntry extends ManualInterest {
  accountId: string;
}

/** Everything the balance, net worth and month figures read, for one pool. */
export interface LedgerData {
  accounts: readonly LedgerAccount[];
  transactions: readonly Transaction[];
  interestEntries: readonly ManualInterestEntry[];
  ops: readonly InvestmentOp[];
  assets: readonly InvestmentAsset[];
  moves: readonly PortfolioCashMove[];
  categories: readonly Category[];
  /** Monthly budget per category id, in EUR. */
  budgets?: Readonly<Record<string, DecInput>>;
  rates: FxRates;
  /** Default tax on deposit interest, in percent. */
  defaultTax: DecInput;
}

/** Effect of an operation on the balance of the account it settles in, in the account's currency. */
function operationEffect(
  op: InvestmentOp,
  account: LedgerAccount,
  asset: InvestmentAsset | undefined,
  rates: FxRates,
): Money {
  if (account.trackCash === false) return dec(0);
  if (asset?.currency === account.currency) return cashEffectNative(op, asset, rates);
  return cashEffect(op, asset, rates).div(fx(account.currency, rates));
}

interface Totals {
  lastTransactionDate: string;
  /** Transactions, interest and operations falling in each date slot (see `slotOf`). */
  slots: Dec[];
}

/**
 * Balance of every account on each of the dates, in the account's own currency, reading the data
 * once. Balance = opening balance (once its date has come) + transactions + interest entries + the
 * effect of its investment operations + deposit flows expected after the last imported
 * transaction (so they are not counted twice). A term deposit is worth its deposit value.
 */
export function accountBalancesAt(
  data: LedgerData,
  dates: readonly string[],
): Map<string, Money>[] {
  const { accounts, rates, defaultTax } = data;
  // Each row is added to one slot only (the earliest date that includes it); the slots are
  // accumulated in date order at the end.
  const order = dates.map((date, index) => ({ date, index })).sort((a, b) => byDate(a, b));
  // First slot whose date is on or after `date` (binary search: the data has thousands of rows).
  const slotOf = (date: string) => {
    let low = 0;
    let high = order.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (date <= (order[mid]?.date ?? '')) high = mid;
      else low = mid + 1;
    }
    return low < order.length ? low : -1;
  };
  const totals = new Map<string, Totals>(
    accounts.map((a) => [a.id, { lastTransactionDate: '', slots: order.map(() => dec(0)) }]),
  );
  const add = (t: Totals, date: string, amount: DecInput) => {
    const slot = slotOf(date);
    const current = t.slots[slot];
    if (current) t.slots[slot] = current.plus(amount);
  };

  for (const tx of data.transactions) {
    const t = totals.get(tx.accountId);
    if (!t) continue;
    if (tx.date > t.lastTransactionDate) t.lastTransactionDate = tx.date;
    add(t, tx.date, tx.amount);
  }
  for (const entry of data.interestEntries) {
    const t = totals.get(entry.accountId);
    if (t) add(t, entry.date, entry.amount);
  }
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const assetById = indexAssets(data.assets);
  for (const op of data.ops) {
    const account = op.accountId ? accountById.get(op.accountId) : undefined;
    const t = account && totals.get(account.id);
    if (account && t)
      add(t, op.date, operationEffect(op, account, assetById.get(op.assetId), rates));
  }

  const deposits = accounts.flatMap((a) => (a.deposit ? [a.deposit] : []));
  const results = dates.map(() => new Map<string, Money>());
  order.forEach(({ date: asOf, index }, slot) => {
    for (const account of accounts) {
      const t = totals.get(account.id);
      if (!t) continue;
      if (account.kind === 'term' && account.deposit) {
        results[index]?.set(account.id, depositValue(account.deposit, asOf, defaultTax).value);
        continue;
      }
      const opening =
        !account.openingDate || account.openingDate <= asOf ? dec(account.opening ?? 0) : dec(0);
      const expected =
        deposits.length === 0
          ? []
          : depositFlows(account.id, deposits, asOf, defaultTax).filter(
              (f) => f.date <= asOf && f.date > t.lastTransactionDate,
            );
      results[index]?.set(
        account.id,
        opening.plus(sum(t.slots.slice(0, slot + 1))).plus(sum(expected.map((f) => f.amount))),
      );
    }
  });
  return results;
}

/** Balance of every account on `asOf`. */
export const accountBalances = (data: LedgerData, asOf: string): Map<string, Money> =>
  accountBalancesAt(data, [asOf])[0] ?? new Map<string, Money>();

/** Balance of one account on `asOf`; prefer `accountBalances` when you need several. */
export function accountBalance(data: LedgerData, accountId: string, asOf: string): Money {
  const balance = accountBalances(data, asOf).get(accountId);
  if (!balance) throw new RangeError(`Unknown account ${accountId}`);
  return balance;
}
