import type { CategoryView, SummaryView, TotalsView } from '@webapp/lib/expenses-types';
// View logic of the Despesas screen (NES-52): the URL state, the budget rows and the optimistic
// totals. Pure functions, so the page and the client components share them and tests cover them.
// Money is arithmetic on integer cents (never a float of an amount): the values arrive as decimal
// strings with at most 4 decimals.

export const EXPENSE_TABS = ['resumo', 'movimentos', 'categorias'] as const;
export type ExpenseTab = (typeof EXPENSE_TABS)[number];

export const parseTab = (value: string | undefined): ExpenseTab =>
  EXPENSE_TABS.find((tab) => tab === value) ?? 'resumo';

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const isMonth = (value: string | undefined): value is string =>
  value !== undefined && MONTH.test(value);

/** `yyyy-mm` of the day (`yyyy-mm-dd`). */
export const monthOf = (day: string): string => day.slice(0, 7);

/** The month `delta` months from `month` (`yyyy-mm`). */
export function shiftMonth(month: string, delta: number): string {
  const match = MONTH.exec(month);
  if (!match) throw new RangeError('Expected yyyy-mm');
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The months the selector offers: two years back from the later of today and the selection. */
export function monthOptions(selected: string, today: string, count = 24): string[] {
  const current = monthOf(today);
  const last = selected > current ? selected : current;
  const months = Array.from({ length: count }, (_, i) => shiftMonth(last, i - count + 1));
  return months.includes(selected) ? months : [selected, ...months];
}

/** `Outubro 2026`. */
export function monthLabel(month: string): string {
  const match = MONTH.exec(month);
  if (!match) return month;
  const text = new Intl.DateTimeFormat('pt-PT', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)));
  const [name = '', year = ''] = text.split(' de ');
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`.trim();
}

/** `Out`: the short label under a bar. */
export function monthShort(month: string): string {
  const match = MONTH.exec(month);
  if (!match) return month;
  const text = new Intl.DateTimeFormat('pt-PT', { month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)),
  );
  const name = text.replace('.', '');
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/** How much of the month has gone by on `today` (`yyyy-mm-dd`): 0 before it, 100 after it. */
export function elapsedPercent(month: string, today: string): number {
  const current = monthOf(today);
  if (month < current) return 100;
  if (month > current) return 0;
  const match = MONTH.exec(month);
  if (!match) return 0;
  const days = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
  return Math.round((Number(today.slice(8, 10)) / days) * 100);
}

// ---------------------------------------------------------------------------------------- filters

export const MOVEMENT_KINDS = ['expense', 'income', 'refund', 'transfer', 'invest'] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

/** The Movimentos filters; they live in the URL, so a refresh or a shared link keeps them. */
export interface MovementFilters {
  /** `yyyy-mm`; empty for every month. */
  month: string;
  accountId: string;
  /** A category id, `none` or empty. */
  categoryId: string;
  kind: '' | MovementKind;
  q: string;
  withNotes: boolean;
  /** The internal transfers stay in the table unless this is off (the mockup's checkbox). */
  showTransfers: boolean;
}

export const NO_FILTERS: MovementFilters = {
  month: '',
  accountId: '',
  categoryId: '',
  kind: '',
  q: '',
  withNotes: false,
  showTransfers: true,
};

type Params = Readonly<Record<string, string | readonly string[] | undefined>>;
const one = (value: string | readonly string[] | undefined): string =>
  (typeof value === 'string' ? value : value?.[0]) ?? '';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads the filters from the query string; anything that is not a valid value is dropped. */
export function parseFilters(params: Params): MovementFilters {
  const month = one(params.month);
  const account = one(params.account);
  const category = one(params.category);
  const kind = one(params.kind);
  return {
    month: isMonth(month) ? month : '',
    accountId: UUID.test(account) ? account : '',
    categoryId: category === 'none' || UUID.test(category) ? category : '',
    kind: MOVEMENT_KINDS.find((entry) => entry === kind) ?? '',
    q: one(params.q).slice(0, 100),
    withNotes: one(params.notes) === '1',
    showTransfers: one(params.transfers) !== '0',
  };
}

/** The filters as the query string of the page (defaults left out, so the URL stays short). */
export function filtersToParams(filters: MovementFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.month) params.set('month', filters.month);
  if (filters.accountId) params.set('account', filters.accountId);
  if (filters.categoryId) params.set('category', filters.categoryId);
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.withNotes) params.set('notes', '1');
  if (!filters.showTransfers) params.set('transfers', '0');
  return params;
}

/** The query string of the API (`/transactions` and `/expenses/totals`) for the filters. */
export function filtersToApiQuery(filters: MovementFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.month) params.set('month', filters.month);
  if (filters.accountId) params.set('accountId', filters.accountId);
  if (filters.categoryId) params.set('categoryId', filters.categoryId);
  // Hiding transfers is a filter on the table only: "kind" picks one kind when it is set.
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.withNotes) params.set('withNotes', 'true');
  return params;
}

// ---------------------------------------------------------------------------------------- budgets

export interface BudgetRow {
  categoryId: string | null;
  value: string;
  budget: string | null;
  /** 0-100 and above; null without a budget. */
  percent: number | null;
  /** `budget - value`; negative once the budget is exceeded. Null without a budget. */
  remaining: string | null;
  tone: 'ok' | 'warn' | 'over';
}

const toCents = (value: string): bigint => {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return 0n;
  const cents = BigInt(`${match[2]}${(match[3] ?? '').padEnd(2, '0').slice(0, 2)}`);
  return match[1] === '-' ? -cents : cents;
};
const fromCents = (cents: bigint): string => {
  const negative = cents < 0n;
  const abs = (negative ? -cents : cents).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${abs.slice(0, -2)}.${abs.slice(-2)}`;
};

export const BUDGET_WARN_AT = 80;

/**
 * The rows of "Orçamento do mês": every category that has a budget (even with nothing spent) and
 * every category spent on, largest spend first. Hidden global categories without spending are left
 * out.
 */
export function budgetRows(
  categories: readonly CategoryView[],
  spent: SummaryView['categories'],
): BudgetRow[] {
  const rows = new Map<string | null, BudgetRow>();
  const add = (categoryId: string | null, value: string, budget: string | null) => {
    const spentCents = toCents(value);
    const budgetCents = budget === null ? 0n : toCents(budget);
    const percent =
      budget !== null && budgetCents > 0n
        ? Number((spentCents * 10000n) / budgetCents) / 100
        : null;
    rows.set(categoryId, {
      categoryId,
      value,
      budget,
      percent,
      remaining: budget === null ? null : fromCents(budgetCents - spentCents),
      tone:
        percent !== null && percent >= 100
          ? 'over'
          : percent !== null && percent >= BUDGET_WARN_AT
            ? 'warn'
            : 'ok',
    });
  };
  for (const entry of spent) add(entry.categoryId, entry.value, entry.budget);
  for (const category of categories) {
    if (category.kind !== 'expense' || rows.has(category.id)) continue;
    const budget = category.monthlyBudget;
    if (budget !== null && toCents(budget) > 0n && !category.hidden) add(category.id, '0', budget);
  }
  return [...rows.values()].sort((a, b) => {
    const diff = toCents(b.value) - toCents(a.value);
    if (diff !== 0n) return diff > 0n ? 1 : -1;
    return Number(toCents(b.budget ?? '0') - toCents(a.budget ?? '0'));
  });
}

/** Spent and budgeted in the categories that have a budget: the "Total orçamentado" line. */
export function budgetTotals(rows: readonly BudgetRow[]): { spent: string; budget: string } {
  const budgeted = rows.filter((row) => row.budget !== null);
  return {
    spent: fromCents(budgeted.reduce((total, row) => total + toCents(row.value), 0n)),
    budget: fromCents(budgeted.reduce((total, row) => total + toCents(row.budget ?? '0'), 0n)),
  };
}

// ---------------------------------------------------------------------------------- optimistic totals

/** What the totals need to know about one movement to move it between kinds. */
export interface TotalsMovement {
  amount: string;
  currency: string;
  kind: MovementKind;
  uncategorized: boolean;
}

/** EUR cents of an amount in a currency, with the EUR-per-unit rates of the totals. */
function eurCents(amount: string, currency: string, rates: Readonly<Record<string, string>>) {
  const rate = currency === 'EUR' ? '1' : (rates[currency] ?? '1');
  const [int = '0', frac = ''] = rate.split('.');
  const scale = 10n ** BigInt(frac.length);
  const value = toCents(amount) * (BigInt(int) * scale + BigInt(frac || '0'));
  return value / scale;
}

/** Adds (`direction` 1) or takes out (-1) a movement of `cents` (signed) in the bucket of its kind. */
function bucket(
  totals: TotalsView,
  kind: MovementKind,
  cents: bigint,
  direction: 1n | -1n,
): TotalsView {
  const delta = cents * direction;
  const add = (value: string, by: bigint) => fromCents(toCents(value) + by);
  switch (kind) {
    case 'income':
      return { ...totals, income: add(totals.income, delta) };
    // Outflows are negative: a more negative amount raises the net expense.
    case 'expense':
    case 'refund':
      return { ...totals, expenses: add(totals.expenses, -delta) };
    case 'invest':
      return { ...totals, invested: add(totals.invested, -delta) };
    // Only the inflow side of an internal transfer is counted.
    case 'transfer':
      return cents > 0n ? { ...totals, transfers: add(totals.transfers, delta) } : totals;
  }
}

/**
 * The totals after a movement changes kind (or category), before the server confirms: the amount
 * leaves the bucket of its old kind and enters the one of its new kind. The server's own totals
 * replace this guess as soon as they arrive.
 */
export function moveInTotals(
  totals: TotalsView,
  movement: TotalsMovement,
  next: { kind: MovementKind; uncategorized: boolean },
): TotalsView {
  const cents = eurCents(movement.amount, movement.currency, totals.rates);
  const left = bucket(totals, movement.kind, cents, -1n);
  const moved = bucket(left, next.kind, cents, 1n);
  const uncategorized =
    totals.uncategorized + (next.uncategorized ? 1 : 0) - (movement.uncategorized ? 1 : 0);
  return { ...moved, uncategorized: Math.max(0, uncategorized) };
}

/**
 * The kind a movement counts as, the way the server decides it: the transfer flag first, then the
 * category's kind, then the sign of the amount.
 */
export function kindFor(
  category: Pick<CategoryView, 'kind'> | undefined,
  amount: string,
  transfer: boolean,
): MovementKind {
  if (transfer) return 'transfer';
  return category?.kind ?? (amount.startsWith('-') ? 'expense' : 'income');
}

/** Keeps a row of the table or not, given the "show internal transfers" checkbox. */
export const isShown = (kind: MovementKind, showTransfers: boolean): boolean =>
  showTransfers || kind !== 'transfer';

// ---------------------------------------------------------------------------------- rules (drag)

/** The ids after moving the item at `from` to the place of the item at `to`. */
export function moveId(ids: readonly string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) {
    return [...ids];
  }
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}

// ------------------------------------------------------------------------------------- typed amounts

/**
 * A positive amount typed by a person (`12,50`, `1 234.5`) as the API's decimal string, or `null`
 * when it is not one. At most 4 decimals, never zero.
 */
export function parseAmountText(text: string): string | null {
  const plain = text.replace(/[\s\u00a0]/g, '').replace(',', '.');
  if (!/^\d{1,14}(\.\d{1,4})?$/.test(plain) || /^0+(\.0+)?$/.test(plain)) return null;
  return plain;
}

/** A budget typed by a person: empty clears it (`null`), otherwise zero or more euros; `undefined` when invalid. */
export function parseBudgetText(text: string): string | null | undefined {
  const plain = text.replace(/[\s\u00a0]/g, '').replace(',', '.');
  if (plain === '') return null;
  return /^\d{1,14}(\.\d{1,4})?$/.test(plain) ? plain : undefined;
}

/** A decimal string as the text a budget field starts with (`120.5000` becomes `120,5`). */
export function budgetToText(budget: string | null): string {
  if (budget === null) return '';
  const trimmed = budget.includes('.') ? budget.replace(/\.?0+$/, '') : budget;
  return trimmed.replace('.', ',');
}
