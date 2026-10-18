import type { LedgerData } from './account-balance';
import { addMonths, lastMonths } from './dates';
import { dec, sum, type Dec, type DecInput, type Money } from './decimal';
import { toEur } from './fx';
import { cashEffect, indexAssets } from './positions';
import { indexCategoryKinds, kindFromCategory } from './transactions';

export interface MonthFlow {
  /** `yyyy-mm`. */
  month: string;
  /** Income-kind transactions plus manually entered interest, in EUR. */
  income: Money;
  /** Expenses minus refunds, in EUR; transfers and investments are not expenses. */
  expenses: Money;
  refunds: Money;
  /** Money moved between own accounts (inflow side), in EUR. */
  transfers: Money;
  /** Buys of the month, in EUR. */
  invested: Money;
  savings: Money;
  /** `savings / income`, `null` without income. */
  savingsRate: Dec | null;
}

interface Accumulator {
  income: Dec;
  /** Sum of the expenses as a positive number. */
  expense: Dec;
  refunds: Dec;
  transfers: Dec;
  invested: Dec;
}

/**
 * Income, expenses, savings and savings rate for each month asked, in one pass over the data.
 * Expenses are net of refunds and exclude transfers and investments.
 */
export function monthFlows(data: LedgerData, months: readonly string[]): MonthFlow[] {
  const acc = new Map<string, Accumulator>(
    months.map((m) => [
      m,
      { income: dec(0), expense: dec(0), refunds: dec(0), transfers: dec(0), invested: dec(0) },
    ]),
  );
  const { rates } = data;
  const currencyOf = new Map(data.accounts.map((a) => [a.id, a.currency]));
  const kindById = indexCategoryKinds(data.categories);

  for (const tx of data.transactions) {
    const a = acc.get(tx.date.slice(0, 7));
    if (!a) continue;
    const kind = kindFromCategory(tx, kindById);
    if (kind === 'transfer' && !dec(tx.amount).gt(0)) continue;
    const eur = toEur(tx.amount, currencyOf.get(tx.accountId), rates);
    if (kind === 'expense') a.expense = a.expense.minus(eur);
    else if (kind === 'refund') a.refunds = a.refunds.plus(eur);
    else if (kind === 'income') a.income = a.income.plus(eur);
    else if (kind === 'transfer') a.transfers = a.transfers.plus(eur);
  }
  for (const entry of data.interestEntries) {
    const a = acc.get(entry.date.slice(0, 7));
    if (a) a.income = a.income.plus(toEur(entry.amount, currencyOf.get(entry.accountId), rates));
  }
  const assetById = indexAssets(data.assets);
  for (const op of data.ops) {
    const a = op.type === 'buy' ? acc.get(op.date.slice(0, 7)) : undefined;
    if (a) a.invested = a.invested.minus(cashEffect(op, assetById.get(op.assetId), rates));
  }

  return months.map((month) => {
    const a = acc.get(month);
    if (!a) throw new RangeError(`Unknown month ${month}`);
    const expenses = a.expense.minus(a.refunds);
    const savings = a.income.minus(expenses);
    return {
      month,
      income: a.income,
      expenses,
      refunds: a.refunds,
      transfers: a.transfers,
      invested: a.invested,
      savings,
      savingsRate: a.income.isZero() ? null : savings.div(a.income),
    };
  });
}

export interface CategoryExpense {
  /** `null` for expenses without a category. */
  categoryId: string | null;
  value: Money;
  /** Monthly budget of the category, if any. */
  budget: Money | null;
  /** `value / budget`, `null` without a budget. */
  budgetUsed: Dec | null;
  /** Average of the same category over the three previous months. */
  previousAverage: Money;
  /** `value − previousAverage`. */
  difference: Money;
}

export const PREVIOUS_MONTHS = 3;
const MIN_VALUE = dec('0.004');

/**
 * Expenses of `month` by category (largest first), each with its budget progress and the
 * difference against the average of the three previous months. Refunds are not netted per
 * category: they only reduce the month total (see `monthFlows`).
 */
export function expensesByCategory(data: LedgerData, month: string): CategoryExpense[] {
  const previous = lastMonths(PREVIOUS_MONTHS, addMonths(`${month}-01`, -1));
  const wanted = new Set([month, ...previous]);
  const perMonth = new Map<string, Map<string | null, Dec>>([...wanted].map((m) => [m, new Map()]));
  const currencyOf = new Map(data.accounts.map((a) => [a.id, a.currency]));
  const kindById = indexCategoryKinds(data.categories);

  for (const tx of data.transactions) {
    const totals = perMonth.get(tx.date.slice(0, 7));
    if (!totals || kindFromCategory(tx, kindById) !== 'expense') continue;
    const key = tx.categoryId ?? null;
    const eur = toEur(tx.amount, currencyOf.get(tx.accountId), data.rates);
    totals.set(key, (totals.get(key) ?? dec(0)).minus(eur));
  }

  const current = perMonth.get(month) ?? new Map<string | null, Dec>();
  return [...current.entries()]
    .filter(([, value]) => value.gt(MIN_VALUE))
    .sort(([, a], [, b]) => b.comparedTo(a))
    .map(([categoryId, value]) => {
      const average = sum(previous.map((m) => perMonth.get(m)?.get(categoryId) ?? dec(0))).div(
        PREVIOUS_MONTHS,
      );
      const raw: DecInput | undefined = categoryId ? data.budgets?.[categoryId] : undefined;
      const budget = raw !== undefined && dec(raw).gt(0) ? dec(raw) : null;
      return {
        categoryId,
        value,
        budget,
        budgetUsed: budget ? value.div(budget) : null,
        previousAverage: average,
        difference: value.minus(average),
      };
    });
}
