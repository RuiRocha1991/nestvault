import type { LedgerData } from './account-balance';
import { addMonths, lastMonths, monthEnd } from './dates';
import { dec, sum, type Dec, type Money } from './decimal';
import { dividendsReceived } from './dividends';
import { toEur } from './fx';
import { accountInterest, type InterestCandidate } from './interest';
import {
  expensesByCategory,
  monthFlows,
  PREVIOUS_MONTHS,
  type CategoryExpense,
} from './month-flows';
import { netWorths } from './net-worth';
import { byDate, cashEffect, indexAssets, type InvestmentOp } from './positions';
import {
  indexCategoryKinds,
  kindFromCategory,
  type CategoryKind,
  type Transaction,
} from './transactions';

export type NotableReason = 'note' | 'top-expense' | 'top-income';

export interface NotableTransaction {
  transaction: Transaction;
  /** In EUR. */
  amount: Money;
  kind: CategoryKind;
  reasons: NotableReason[];
}

export interface MonthOperations {
  portfolioId: string | null;
  operations: { op: InvestmentOp; cashEffect: Money }[];
}

export interface MonthReview {
  month: string;
  income: Money;
  expenses: Money;
  savings: Money;
  savingsRate: Dec | null;
  netWorthEnd: Money;
  netWorthPrevious: Money;
  netWorthChange: Money;
  invested: Money;
  /** Capital of loan installments paid in the month: savings, not an expense. */
  loanCapital: Money;
  dividendsReceived: Money;
  interestReceived: Money;
  categories: CategoryExpense[];
  /** Every transaction with a note, the largest expenses and the largest income. */
  notable: NotableTransaction[];
  /** Investment operations of the month, per portfolio. */
  operations: MonthOperations[];
}

const TOP_EXPENSES = 5;

/**
 * The monthly review: KPIs, expenses by category, notable transactions and investment operations
 * of `month`. Income, expenses, invested and categories come from `monthFlows` and
 * `expensesByCategory`, so every screen shows the same numbers. `today` selects the prices for the
 * net worth at the end of the month and of the previous one.
 */
export function monthReview(data: LedgerData, month: string, today: string): MonthReview {
  // The month figures only read this month and the three before it: narrow the transactions
  // once instead of scanning the whole history for every figure.
  const end = monthEnd(month);
  const previous = lastMonths(PREVIOUS_MONTHS, addMonths(`${month}-01`, -1));
  const from = `${previous[0] ?? month}-01`;
  const window: LedgerData = {
    ...data,
    transactions: data.transactions.filter((t) => t.date >= from && t.date <= end),
  };
  const [flow] = monthFlows(window, [month]);
  if (!flow) throw new RangeError(`Unknown month ${month}`);
  const previousEnd = monthEnd(previous[PREVIOUS_MONTHS - 1] ?? month);
  const [atEnd, atPrevious] = netWorths(data, [end, previousEnd], today);
  const worthEnd = atEnd?.net ?? dec(0);
  const worthPrevious = atPrevious?.net ?? dec(0);

  const assetById = indexAssets(data.assets);
  const monthOps = data.ops.filter((op) => op.date.slice(0, 7) === month);
  const byPortfolio = new Map<string | null, MonthOperations>();
  for (const op of monthOps.sort(byDate)) {
    const key = op.portfolioId ?? null;
    const group = byPortfolio.get(key) ?? { portfolioId: key, operations: [] };
    group.operations.push({
      op,
      cashEffect: cashEffect(op, assetById.get(op.assetId), data.rates),
    });
    byPortfolio.set(key, group);
  }

  return {
    month,
    income: flow.income,
    expenses: flow.expenses,
    savings: flow.savings,
    savingsRate: flow.savingsRate,
    netWorthEnd: worthEnd,
    netWorthPrevious: worthPrevious,
    netWorthChange: worthEnd.minus(worthPrevious),
    invested: flow.invested,
    loanCapital: flow.loanCapital,
    dividendsReceived: dividendsReceived(data.ops, data.assets, data.rates, [month])[0] ?? dec(0),
    interestReceived: interestOfMonth(window, month),
    categories: expensesByCategory(window, month),
    notable: notableTransactions(window, month),
    operations: [...byPortfolio.values()],
  };
}

/** Interest received in the month on every account (scheduled, manual and from statements). */
function interestOfMonth(data: LedgerData, month: string): Money {
  const categoryById = new Map(data.categories.map((c) => [c.id, c]));
  const candidatesByAccount = new Map<string, InterestCandidate[]>();
  for (const t of data.transactions) {
    if (t.date.slice(0, 7) !== month) continue;
    const category = t.categoryId ? categoryById.get(t.categoryId) : undefined;
    const list = candidatesByAccount.get(t.accountId) ?? [];
    list.push({
      id: t.id,
      date: t.date,
      amount: t.amount,
      description: t.description,
      ...(t.transfer !== undefined && { transfer: t.transfer }),
      ...(t.depositInterest !== undefined && { depositInterest: t.depositInterest }),
      category: category ? { kind: category.kind, systemKey: category.systemKey ?? null } : null,
    });
    candidatesByAccount.set(t.accountId, list);
  }
  const manualByAccount = new Map<string, (typeof data.interestEntries)[number][]>();
  for (const e of data.interestEntries) {
    const list = manualByAccount.get(e.accountId) ?? [];
    list.push(e);
    manualByAccount.set(e.accountId, list);
  }

  const end = monthEnd(month);
  const amounts: Money[] = [];
  for (const account of data.accounts) {
    const entries = accountInterest(
      {
        deposit: account.deposit ?? null,
        manual: manualByAccount.get(account.id) ?? [],
        transactions: candidatesByAccount.get(account.id) ?? [],
      },
      end,
      data.defaultTax,
    ).filter((e) => e.date.slice(0, 7) === month);
    amounts.push(...entries.map((e) => toEur(e.amount, account.currency, data.rates)));
  }
  return sum(amounts);
}

function notableTransactions(data: LedgerData, month: string): NotableTransaction[] {
  const currencyOf = new Map(data.accounts.map((a) => [a.id, a.currency]));
  const kindById = indexCategoryKinds(data.categories);
  const items = data.transactions
    .filter((t) => t.date.slice(0, 7) === month)
    .map((transaction) => ({
      transaction,
      amount: toEur(transaction.amount, currencyOf.get(transaction.accountId), data.rates),
      kind: kindFromCategory(transaction, kindById),
      reasons: [] as NotableReason[],
    }));

  for (const item of items) if (item.transaction.note) item.reasons.push('note');
  const expenses = items
    .filter((i) => i.kind === 'expense')
    .sort((a, b) => a.amount.comparedTo(b.amount));
  for (const item of expenses.slice(0, TOP_EXPENSES)) item.reasons.push('top-expense');
  const topIncome = items
    .filter((i) => i.kind === 'income')
    .sort((a, b) => b.amount.comparedTo(a.amount))[0];
  topIncome?.reasons.push('top-income');

  return items
    .filter((i) => i.reasons.length > 0)
    .sort((a, b) => b.amount.abs().comparedTo(a.amount.abs()));
}
