import type { OverviewDto, OverviewRange } from '@nestvault/services';

import { categoryMessageKey } from './category-name';

/** What the overview service returns; components take it from here, never from the services root. */
export type OverviewData = OverviewDto;

export const RANGES: readonly OverviewRange[] = ['6', '12', '24', 'all'];
export const DEFAULT_RANGE: OverviewRange = '12';

/** The `?periodo=` of the URL; anything unknown falls back to 12 months. */
export function parseRange(value: string | string[] | undefined): OverviewRange {
  const first = Array.isArray(value) ? value[0] : value;
  return RANGES.find((range) => range === first) ?? DEFAULT_RANGE;
}

/** The expense categories drawn in the donut; the rest are summed into one "others" slice. */
export const DONUT_CATEGORIES = 5;

export interface CategorySlice {
  key: string;
  /** Message key below `categories` for a global category. */
  messageKey: string | null;
  /** Name of a custom category. */
  name: string | null;
  color: string;
  value: number;
  /** The summed rest, or an expense without a category. */
  kind: 'category' | 'others' | 'uncategorized';
}

export const OTHERS_COLOR = '#8C8FB8';

/** The five largest categories plus an "others" slice with the rest (the prototype's donut). */
export function topCategories(
  categories: OverviewDto['expenses']['categories'],
  limit = DONUT_CATEGORIES,
): CategorySlice[] {
  const slices = categories.map((item): CategorySlice => {
    const uncategorized = item.categoryId === null;
    return {
      key: item.categoryId ?? 'none',
      messageKey: item.systemKey ? categoryMessageKey(item.systemKey) : null,
      name: item.name,
      color: item.color,
      value: Number(item.value),
      kind: uncategorized ? 'uncategorized' : 'category',
    };
  });
  const top = slices.slice(0, limit);
  const rest = slices.slice(limit);
  if (rest.length > 0) {
    top.push({
      key: 'others',
      messageKey: null,
      name: null,
      color: OTHERS_COLOR,
      value: rest.reduce((total, slice) => total + slice.value, 0),
      kind: 'others',
    });
  }
  return top;
}

const MONTH_KEYS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;
export type MonthKey = (typeof MONTH_KEYS)[number];

/** `2026-10` → `oct`, the key of its short name in `overview.monthsShort`. */
export function monthKeyOf(month: string): MonthKey {
  return MONTH_KEYS[Number(month.slice(5, 7)) - 1] ?? 'jan';
}

/** `+0,2%`-style tone: green for a rise, red for a fall (an expense rise is bad: `inverse`). */
export function deltaTone(value: number, inverse = false): 'pos' | 'neg' | 'muted' {
  if (value === 0) return 'muted';
  return value > 0 !== inverse ? 'pos' : 'neg';
}

/** The goal status the prototype shows, and its tone. */
export function goalTone(status: OverviewDto['goals'][number]['status']): 'pos' | 'warn' | 'muted' {
  if (status === 'reached' || status === 'on_track' || status === 'eta') return 'pos';
  if (status === 'tracking') return 'muted';
  return 'warn';
}
