import { daysBetween } from './dates';
import { dec, roundCents, type Dec } from './decimal';
import { byDate } from './positions';
import { findCategoryByKind, type Category, type Transaction } from './transactions';

export interface TransferAccount {
  id: string;
  currency: string;
  /** A brokerage destination makes the pair an investment instead of a transfer. */
  isBrokerage?: boolean;
}

/** An outflow and the inflow it was paired with, and what to record on them. */
export interface TransferPair {
  outflowId: string;
  inflowId: string;
  /** Transfer category, or the investment one when the destination is a brokerage account. */
  categoryId: string | null;
  /** False when the user chose that side's category by hand. */
  setOutflowCategory: boolean;
  setInflowCategory: boolean;
}

export interface TransferOptions {
  /** Maximum days between the two sides. */
  days?: number;
}

const DEFAULT_DAYS = 3;
const centsKey = (amount: Dec): string => roundCents(amount).toFixed(2);

/**
 * Pairs each unpaired, unlocked outflow with an inflow of exactly the same cents in a different
 * account of the same currency within `days` days; the closest date wins. Outflows are handled
 * oldest first and an inflow is used once. Pure: the caller persists the decisions.
 */
export function detectTransfers(
  transactions: readonly Transaction[],
  accounts: readonly TransferAccount[],
  categories: readonly Category[],
  options: TransferOptions = {},
): TransferPair[] {
  const days = options.days ?? DEFAULT_DAYS;
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const currencyOf = (id: string) => accountById.get(id)?.currency ?? 'EUR';
  const transferCategory = findCategoryByKind(categories, 'transfer')?.id ?? null;
  const investCategory = findCategoryByKind(categories, 'invest')?.id ?? null;

  const inflowsByCents = new Map<string, Transaction[]>();
  const outflows: Transaction[] = [];
  for (const tx of transactions) {
    if (tx.pairId || tx.transferLocked) continue;
    const amount = dec(tx.amount);
    if (amount.gt(0)) {
      const key = centsKey(amount);
      const bucket = inflowsByCents.get(key);
      if (bucket) bucket.push(tx);
      else inflowsByCents.set(key, [tx]);
    } else if (amount.lt(0)) {
      outflows.push(tx);
    }
  }

  const used = new Set<string>();
  const pairs: TransferPair[] = [];
  for (const out of outflows.sort(byDate)) {
    const candidates = inflowsByCents.get(centsKey(dec(out.amount).neg()));
    if (!candidates) continue;
    const outCurrency = currencyOf(out.accountId);
    let best: Transaction | null = null;
    let bestDays = days + 1;
    for (const inflow of candidates) {
      if (used.has(inflow.id) || inflow.accountId === out.accountId) continue;
      if (currencyOf(inflow.accountId) !== outCurrency) continue;
      const apart = Math.abs(daysBetween(out.date, inflow.date));
      if (apart <= days && apart < bestDays) {
        bestDays = apart;
        best = inflow;
      }
    }
    if (!best) continue;
    used.add(best.id);
    const toBrokerage = accountById.get(best.accountId)?.isBrokerage === true;
    pairs.push({
      outflowId: out.id,
      inflowId: best.id,
      categoryId: toBrokerage && investCategory ? investCategory : transferCategory,
      setOutflowCategory: !out.manualCategory,
      setInflowCategory: !best.manualCategory,
    });
  }
  return pairs;
}
