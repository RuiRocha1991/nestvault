import { formatMoney, formatPct } from '@nestvault/ui';

import type { OpView } from './portfolios-types';

export const PORTFOLIO_TABS = [
  'summary',
  'positions',
  'dividends',
  'transactions',
  'analysis',
] as const;
export type PortfolioTab = (typeof PORTFOLIO_TABS)[number];

/** `?tab=` of the URL; anything else is the summary. */
export function parseTab(value: string | string[] | undefined): PortfolioTab {
  const first = Array.isArray(value) ? value[0] : value;
  return PORTFOLIO_TABS.find((tab) => tab === first) ?? 'summary';
}

export type PositionsGroup = 'asset' | 'account';

/** `?group=` of the positions tab; by asset unless the URL asks for accounts. */
export function parseGroup(value: string | string[] | undefined): PositionsGroup {
  return (Array.isArray(value) ? value[0] : value) === 'account' ? 'account' : 'asset';
}

export type CurrencyMode = 'portfolio' | 'base';

/** `?moeda=` of the URL: the portfolio's own currency unless the URL asks for the base currency. */
export function parseCurrencyMode(value: string | string[] | undefined): CurrencyMode {
  return (Array.isArray(value) ? value[0] : value) === 'base' ? 'base' : 'portfolio';
}

/**
 * Path of the Portfolios screen: all portfolios, or one; the tab only when it is not the summary
 * and the currency only when it is not the default (the portfolio's own).
 */
export function portfoliosPath(
  poolId: string,
  portfolioId: string | null,
  tab: PortfolioTab = 'summary',
  group: PositionsGroup = 'asset',
  currency: CurrencyMode = 'portfolio',
): string {
  const base = `/${encodeURIComponent(poolId)}/portfolios${
    portfolioId ? `/${encodeURIComponent(portfolioId)}` : ''
  }`;
  const query = new URLSearchParams();
  if (tab !== 'summary') query.set('tab', tab);
  if (tab === 'positions' && group === 'account') query.set('group', 'account');
  if (currency === 'base') query.set('moeda', 'base');
  const text = query.toString();
  return text ? `${base}?${text}` : base;
}

/** The sign of a decimal string: -1, 0 or 1. */
export function signOf(value: string): -1 | 0 | 1 {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return 0;
  return number < 0 ? -1 : 1;
}

/** Text colour class of a gain (green), a loss (red) or zero (muted). */
export function toneClass(value: string): string {
  const sign = signOf(value);
  if (sign > 0) return 'text-pos';
  return sign < 0 ? 'text-neg' : 'text-fg-2';
}

/** The value on a portfolio chip: whole units from 10 000 up, cents below (the prototype's `fmt0C`). */
export function chipMoney(value: string, currency: string): string {
  return formatMoney(value, currency, { digits: Math.abs(Number(value)) >= 10_000 ? 0 : 2 });
}

/** A fraction string (`0.113`) as a percentage text (`11,3%`). */
export function fractionPct(fraction: string, signed = false, digits = 1): string {
  return formatPct(Number(fraction) * 100, { digits, signed });
}

/** `formatMoney` with a plus sign on gains; the minus of losses comes from the formatter. */
export function withPlus(text: string, value: string): string {
  return signOf(value) > 0 ? `+${text}` : text;
}

export type OpTypeFilter = 'all' | 'buy' | 'sell' | 'dividend';

export interface OpFilters {
  type: OpTypeFilter;
  assetId: string;
  accountId: string;
  from: string;
  to: string;
  /** Free text matched against the ticker, name and note, case-insensitive. */
  text: string;
}

export const EMPTY_OP_FILTERS: OpFilters = {
  type: 'all',
  assetId: '',
  accountId: '',
  from: '',
  to: '',
  text: '',
};

export interface OpAsset {
  id: string;
  ticker: string;
  name: string;
}

/** The operations that pass every filter that is set (dates inclusive). */
export function filterOps(
  ops: readonly OpView[],
  filters: OpFilters,
  assets: ReadonlyMap<string, OpAsset>,
): OpView[] {
  const text = filters.text.trim().toLowerCase();
  return ops.filter((op) => {
    if (filters.type !== 'all' && op.type !== filters.type) return false;
    if (filters.assetId && op.assetId !== filters.assetId) return false;
    if (filters.accountId && op.accountId !== filters.accountId) return false;
    if (filters.from && op.date < filters.from) return false;
    if (filters.to && op.date > filters.to) return false;
    if (text) {
      const asset = assets.get(op.assetId);
      const haystack = `${asset?.ticker ?? ''} ${asset?.name ?? ''} ${op.note ?? ''}`.toLowerCase();
      if (!haystack.includes(text)) return false;
    }
    return true;
  });
}

export type PerformanceRange = 'sixMonths' | 'oneYear' | 'threeYears' | 'all';

const RANGE_MONTHS: Record<Exclude<PerformanceRange, 'all'>, number> = {
  sixMonths: 6,
  oneYear: 12,
  threeYears: 36,
};

/** The last points of the monthly series for the chosen range (all of them for `all`). */
export function sliceRange<T>(values: readonly T[], range: PerformanceRange): T[] {
  if (range === 'all') return [...values];
  return values.slice(-RANGE_MONTHS[range]);
}

/** The month before a `yyyy-mm` key. */
function previousMonth(month: string): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, '0')}`;
}

export interface PerformanceWindow {
  months: string[];
  value: number[];
  invested: number[];
}

/**
 * The chart's series for a range. A fixed range always spans its months: before the portfolio
 * existed the value and the invested amount are 0, like the prototype's chart (a portfolio that
 * started in December still shows November). "Tudo" starts at the first month.
 */
export function performanceWindow(
  performance: { months: readonly string[]; value: readonly string[]; invested: readonly string[] },
  range: PerformanceRange,
): PerformanceWindow {
  const months = sliceRange(performance.months, range);
  const value = sliceRange(performance.value, range).map(Number);
  const invested = sliceRange(performance.invested, range).map(Number);
  const wanted = range === 'all' ? 0 : RANGE_MONTHS[range];
  while (months.length > 0 && months.length < wanted) {
    months.unshift(previousMonth(months[0] as string));
    value.unshift(0);
    invested.unshift(0);
  }
  return { months, value, invested };
}

const MONTH_FORMAT = new Intl.DateTimeFormat('pt-PT', { month: 'short', timeZone: 'UTC' });

/** Short month name of a `yyyy-mm` key (`2026-02` → `fev`). */
export function monthLabel(month: string): string {
  const at = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return month;
  const short = MONTH_FORMAT.format(at).replace('.', '');
  return short.charAt(0).toUpperCase() + short.slice(1);
}

/** Positions of one account, grouped for the by-account view; accounts keep the input order. */
export interface PositionGroup<T extends { accountId: string | null }> {
  accountId: string | null;
  rows: T[];
}

export function groupByAccount<T extends { accountId: string | null }>(
  rows: readonly T[],
): PositionGroup<T>[] {
  const groups = new Map<string, PositionGroup<T>>();
  for (const row of rows) {
    const key = row.accountId ?? '';
    const group = groups.get(key) ?? { accountId: row.accountId, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Two letters or digits of a ticker for the asset badge. */
export function badgeText(ticker: string): string {
  return ticker.slice(0, 4);
}

/** A decimal string as a whole number of ten-thousandths (the scale of money in the API). */
function toUnits(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return 0n;
  const [, sign, whole, fraction = ''] = match;
  const units = BigInt(`${whole}${fraction.padEnd(4, '0').slice(0, 4)}`);
  return sign === '-' ? -units : units;
}

/** Exact sum of decimal strings, rounded to cents; for display of totals the API does not send. */
export function sumMoney(values: readonly string[]): string {
  const units = values.reduce((total, value) => total + toUnits(value), 0n);
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const cents = (abs + 50n) / 100n;
  const text = cents.toString().padStart(3, '0');
  return `${negative && cents > 0n ? '-' : ''}${text.slice(0, -2)}.${text.slice(-2)}`;
}

const MONTH_LONG = new Intl.DateTimeFormat('pt-PT', { month: 'long', timeZone: 'UTC' });

/** Full month name of a `yyyy-mm` key, capitalised (`2026-02` → `Fevereiro`). */
export function monthName(month: string): string {
  const at = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return month;
  const name = MONTH_LONG.format(at);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** A price older than this many days is flagged as out of date. */
export const STALE_PRICE_DAYS = 7;

/** Whole days from `from` to `to` (both `yyyy-mm-dd`). */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : 0;
}

/** A decimal string with the opposite sign. */
export const negate = (value: string): string =>
  value.startsWith('-') ? value.slice(1) : `-${value}`;
