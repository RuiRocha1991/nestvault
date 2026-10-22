import { describe, expect, it } from 'vitest';

import type { OpView } from '../../apps/web/src/lib/portfolios-types';
import {
  badgeText,
  EMPTY_OP_FILTERS,
  filterOps,
  fractionPct,
  groupByAccount,
  monthLabel,
  monthName,
  parseCurrencyMode,
  parseGroup,
  parseTab,
  performanceWindow,
  portfoliosPath,
  signOf,
  sliceRange,
  sumMoney,
  toneClass,
  withPlus,
} from '../../apps/web/src/lib/portfolios-view';

const op = (patch: Partial<OpView>): OpView => ({
  id: '1',
  portfolioId: 'p',
  assetId: 'a',
  accountId: null,
  subAccountId: null,
  type: 'buy',
  date: '2026-03-10',
  qty: '1',
  price: '1',
  fee: null,
  amount: null,
  gross: null,
  tax: null,
  fromCash: false,
  planId: null,
  note: null,
  native: '-1',
  converted: '-1',
  ...patch,
});

describe('tab and group in the URL', () => {
  it('parses a known tab and falls back to the summary', () => {
    expect(parseTab('dividends')).toBe('dividends');
    expect(parseTab(['analysis', 'x'])).toBe('analysis');
    expect(parseTab('nope')).toBe('summary');
    expect(parseTab(undefined)).toBe('summary');
  });

  it('parses the positions grouping', () => {
    expect(parseGroup('account')).toBe('account');
    expect(parseGroup('x')).toBe('asset');
    expect(parseGroup(undefined)).toBe('asset');
  });

  it('builds the path, encoding ids and keeping only what differs from the default', () => {
    expect(portfoliosPath('pool', null)).toBe('/pool/portfolios');
    expect(portfoliosPath('pool', 'p1', 'dividends')).toBe('/pool/portfolios/p1?tab=dividends');
    expect(portfoliosPath('pool', null, 'positions', 'account')).toBe(
      '/pool/portfolios?tab=positions&group=account',
    );
    expect(portfoliosPath('pool', null, 'transactions', 'account')).toBe(
      '/pool/portfolios?tab=transactions',
    );
    expect(portfoliosPath('a/b', '../x')).toBe('/a%2Fb/portfolios/..%2Fx');
  });

  it('keeps the base currency in the path, and reads only a known value from the URL', () => {
    expect(portfoliosPath('pool', 'p1', 'summary', 'asset', 'base')).toBe(
      '/pool/portfolios/p1?moeda=base',
    );
    expect(portfoliosPath('pool', null, 'dividends', 'asset', 'base')).toBe(
      '/pool/portfolios?tab=dividends&moeda=base',
    );
    expect(portfoliosPath('pool', 'p1', 'summary', 'asset', 'portfolio')).toBe(
      '/pool/portfolios/p1',
    );
    expect(parseCurrencyMode('base')).toBe('base');
    expect(parseCurrencyMode(['base', 'portfolio'])).toBe('base');
    expect(parseCurrencyMode('portfolio')).toBe('portfolio');
    expect(parseCurrencyMode("base' OR 1=1 --")).toBe('portfolio');
    expect(parseCurrencyMode(undefined)).toBe('portfolio');
  });
});

describe('number helpers', () => {
  it('reads the sign and picks the tone', () => {
    expect(signOf('-0.5')).toBe(-1);
    expect(signOf('0')).toBe(0);
    expect(signOf('12.3')).toBe(1);
    expect(toneClass('1')).toBe('text-pos');
    expect(toneClass('-1')).toBe('text-neg');
    expect(toneClass('0')).toBe('text-fg-2');
  });

  it('adds a plus only to gains', () => {
    expect(withPlus('10,00 €', '10')).toBe('+10,00 €');
    expect(withPlus('-10,00 €', '-10')).toBe('-10,00 €');
    expect(withPlus('0,00 €', '0')).toBe('0,00 €');
  });

  it('formats a fraction as a percentage', () => {
    expect(fractionPct('0.113', true)).toBe('+11,3%');
    expect(fractionPct('0.727')).toBe('72,7%');
  });

  it('sums decimal strings in cents', () => {
    expect(sumMoney(['0.1', '0.2', '1.005'])).toBe('1.31');
    expect(sumMoney([])).toBe('0.00');
  });
});

describe('performance range and labels', () => {
  const months = Array.from({ length: 20 }, (_, i) => i);

  it('keeps the last n months of the range, like the prototype', () => {
    expect(sliceRange(months, 'sixMonths')).toHaveLength(6);
    expect(sliceRange(months, 'oneYear')).toHaveLength(12);
    expect(sliceRange(months, 'threeYears')).toHaveLength(20);
    expect(sliceRange(months, 'all')).toHaveLength(20);
  });

  it('pads a fixed range with zero months before the portfolio existed, but not "Tudo"', () => {
    const young = { months: ['2025-12', '2026-01'], value: ['10', '20'], invested: ['10', '10'] };
    const year = performanceWindow(young, 'oneYear');
    expect(year.months).toHaveLength(12);
    expect(year.months[0]).toBe('2025-02');
    expect(year.months.slice(-2)).toEqual(['2025-12', '2026-01']);
    expect(year.value.slice(0, 10).every((v) => v === 0)).toBe(true);
    expect(year.value.slice(-2)).toEqual([10, 20]);
    expect(year.invested.slice(-2)).toEqual([10, 10]);
    expect(performanceWindow(young, 'all').months).toEqual(['2025-12', '2026-01']);
    // Nothing to plot stays empty (the empty state shows instead of a row of zeros).
    expect(performanceWindow({ months: [], value: [], invested: [] }, 'oneYear').months).toEqual(
      [],
    );
  });

  it('names months in Portuguese', () => {
    expect(monthLabel('2026-02')).toBe('Fev');
    expect(monthName('2026-09')).toBe('Setembro');
    expect(monthLabel('bad')).toBe('bad');
  });

  it('shortens a ticker for the badge', () => {
    expect(badgeText('VWCE.DE')).toBe('VWCE');
  });
});

describe('filterOps', () => {
  const assets = new Map([
    ['a', { id: 'a', ticker: 'VWCE', name: 'Vanguard All-World' }],
    ['b', { id: 'b', ticker: 'AAPL', name: 'Apple' }],
  ]);
  const ops = [
    op({ id: '1', assetId: 'a', date: '2026-01-05', accountId: 'x' }),
    op({ id: '2', assetId: 'b', type: 'dividend', date: '2026-02-05', note: 'trimestral' }),
    op({ id: '3', assetId: 'b', type: 'sell', date: '2026-03-05' }),
  ];
  const ids = (found: OpView[]) => found.map((o) => o.id);

  it('returns everything without filters', () => {
    expect(ids(filterOps(ops, EMPTY_OP_FILTERS, assets))).toEqual(['1', '2', '3']);
  });

  it('filters by type, asset, account and inclusive dates', () => {
    expect(ids(filterOps(ops, { ...EMPTY_OP_FILTERS, type: 'dividend' }, assets))).toEqual(['2']);
    expect(ids(filterOps(ops, { ...EMPTY_OP_FILTERS, assetId: 'b' }, assets))).toEqual(['2', '3']);
    expect(ids(filterOps(ops, { ...EMPTY_OP_FILTERS, accountId: 'x' }, assets))).toEqual(['1']);
    expect(
      ids(filterOps(ops, { ...EMPTY_OP_FILTERS, from: '2026-02-05', to: '2026-03-05' }, assets)),
    ).toEqual(['2', '3']);
  });

  it('searches ticker, name and note without case, and never as a pattern', () => {
    expect(ids(filterOps(ops, { ...EMPTY_OP_FILTERS, text: 'apple' }, assets))).toEqual(['2', '3']);
    expect(ids(filterOps(ops, { ...EMPTY_OP_FILTERS, text: 'TRIMESTRAL' }, assets))).toEqual(['2']);
    expect(ids(filterOps(ops, { ...EMPTY_OP_FILTERS, text: '.*' }, assets))).toEqual([]);
  });
});

describe('groupByAccount', () => {
  it('groups rows by account in first-seen order, with no account as its own group', () => {
    const groups = groupByAccount([
      { accountId: 'x', n: 1 },
      { accountId: null, n: 2 },
      { accountId: 'x', n: 3 },
    ]);
    expect(groups.map((g) => [g.accountId, g.rows.map((r) => r.n)])).toEqual([
      ['x', [1, 3]],
      [null, [2]],
    ]);
  });
});
