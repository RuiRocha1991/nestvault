import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RANGE,
  deltaTone,
  goalTone,
  monthKeyOf,
  OTHERS_COLOR,
  parseRange,
  topCategories,
} from '@webapp/lib/overview-view';
import { matchAssets, parseSearchQuery } from '@webapp/lib/search-view';

const category = (n: number, value: string, over: Record<string, unknown> = {}) => ({
  categoryId: `0192f3a1-0000-7000-8000-00000000000${n}`,
  systemKey: `key-${n}`,
  name: null,
  color: '#112233',
  value,
  ...over,
});

describe('parseRange', () => {
  it('accepts the four periods and falls back to 12 months for anything else', () => {
    expect(parseRange('6')).toBe('6');
    expect(parseRange('24')).toBe('24');
    expect(parseRange('all')).toBe('all');
    expect(parseRange(undefined)).toBe(DEFAULT_RANGE);
    expect(parseRange('7')).toBe(DEFAULT_RANGE);
    expect(parseRange("6' OR 1=1")).toBe(DEFAULT_RANGE);
    expect(parseRange(['24', '6'])).toBe('24');
  });
});

describe('topCategories', () => {
  it('keeps the five largest and sums the rest into one "others" slice', () => {
    const items = ['60', '50', '40', '30', '20', '7', '3'].map((value, i) =>
      category(i + 1, value),
    );
    const slices = topCategories(items);
    expect(slices).toHaveLength(6);
    expect(slices.slice(0, 5).map((slice) => slice.value)).toEqual([60, 50, 40, 30, 20]);
    expect(slices[5]).toMatchObject({ kind: 'others', value: 10, color: OTHERS_COLOR });
  });

  it('adds no "others" slice for five categories or fewer, and names the camelCase message key', () => {
    const slices = topCategories([category(1, '10', { systemKey: 'leisure-travel' })]);
    expect(slices).toHaveLength(1);
    expect(slices[0]).toMatchObject({ kind: 'category', messageKey: 'leisureTravel' });
  });

  it('marks an expense without a category and keeps the name of a custom one', () => {
    const slices = topCategories([
      category(1, '10', { categoryId: null, systemKey: null }),
      category(2, '5', { systemKey: null, name: 'Cantina' }),
    ]);
    expect(slices[0]).toMatchObject({ kind: 'uncategorized', messageKey: null });
    expect(slices[1]).toMatchObject({ kind: 'category', messageKey: null, name: 'Cantina' });
  });
});

describe('monthKeyOf and tones', () => {
  it('maps a yyyy-mm month to the key of its short name', () => {
    expect(monthKeyOf('2026-01')).toBe('jan');
    expect(monthKeyOf('2026-10')).toBe('oct');
    expect(monthKeyOf('2026-12')).toBe('dec');
  });

  it('tones a change green for a rise and red for a fall, the other way round for expenses', () => {
    expect(deltaTone(1)).toBe('pos');
    expect(deltaTone(-1)).toBe('neg');
    expect(deltaTone(0)).toBe('muted');
    expect(deltaTone(5, true)).toBe('neg');
    expect(deltaTone(-5, true)).toBe('pos');
  });

  it('tones the goal statuses', () => {
    expect(goalTone('reached')).toBe('pos');
    expect(goalTone('on_track')).toBe('pos');
    expect(goalTone('eta')).toBe('pos');
    expect(goalTone('behind')).toBe('warn');
    expect(goalTone('no_contribution')).toBe('warn');
    expect(goalTone('tracking')).toBe('muted');
  });
});

describe('search helpers', () => {
  it('trims the query and refuses empty, long and control-character text', () => {
    expect(parseSearchQuery('  VWCE ')).toBe('VWCE');
    expect(parseSearchQuery(undefined)).toBeNull();
    expect(parseSearchQuery('   ')).toBeNull();
    expect(parseSearchQuery('x'.repeat(101))).toBeNull();
    expect(parseSearchQuery('a\u0000b')).toBeNull();
    expect(parseSearchQuery(['galp', 'x'])).toBe('galp');
  });

  it('matches assets by ticker, symbol or name, literally and without case', () => {
    const assets = [
      { ticker: 'VWCE', symbol: 'VWCE.DE', name: 'Vanguard FTSE All-World' },
      { ticker: 'EUNL', symbol: null, name: 'iShares Core MSCI World' },
    ];
    expect(matchAssets(assets, 'vwce')).toHaveLength(1);
    expect(matchAssets(assets, 'world')).toHaveLength(2);
    expect(matchAssets(assets, '.de')).toHaveLength(1);
    expect(matchAssets(assets, '%')).toEqual([]);
    expect(matchAssets(assets, "' OR 1=1 --")).toEqual([]);
  });
});
