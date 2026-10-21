import { describe, expect, it } from 'vitest';

import {
  allocationBy,
  computeHoldings,
  DEFAULT_FX_RATES,
  portfolioDiagnostics,
  toPlain,
  type InvestmentAsset,
} from '@nestvault/domain';

import { makeOp, must } from '../support/investments';

const asOf = '2026-09-15';
const assets: InvestmentAsset[] = [
  { id: 'big', currency: 'EUR', price: '100' },
  { id: 'mid', currency: 'EUR', price: '10' },
  { id: 'usd', currency: 'USD', price: '10' },
];
const ops = [
  makeOp({ type: 'buy', assetId: 'big', date: '2026-01-01', qty: '7', price: '90' }),
  makeOp({ type: 'buy', assetId: 'mid', date: '2026-01-01', qty: '10', price: '9' }),
  makeOp({ type: 'buy', assetId: 'usd', date: '2026-01-01', qty: '20', price: '9' }),
];
const holdings = computeHoldings(ops, assets, DEFAULT_FX_RATES, { asOf, today: asOf });
const open = holdings.filter((h) => h.isOpen);
const attributes = {
  sector: (h: { assetId: string }) => (h.assetId === 'big' ? 'Tech' : 'Other'),
  region: () => 'Global',
};

describe('allocationBy', () => {
  it('sums EUR value per key, biggest first', () => {
    const slices = allocationBy(open, (h) => h.currency);
    expect(slices.map((s) => s.name)).toEqual(['EUR', 'USD']);
    expect(toPlain(must(slices[0]).value)).toBe('800');
    expect(toPlain(must(slices[1]).value)).toBe('184');
  });

  it('is empty without positions', () => {
    expect(allocationBy([], () => 'x')).toEqual([]);
  });
});

describe('portfolioDiagnostics', () => {
  it('flags a position above 25 % and counts sectors and regions', () => {
    const [top, three, foreign, diversification] = portfolioDiagnostics(open, attributes);
    expect(top).toMatchObject({ code: 'topPosition', bad: true, assetId: 'big' });
    expect(must(top).weight?.toFixed(3)).toBe('0.711');
    // Only three open positions: the top-three rule needs more than three.
    expect(three).toMatchObject({ code: 'topThree', bad: false });
    expect(foreign).toMatchObject({ code: 'foreignCurrency', bad: false });
    expect(diversification).toMatchObject({ positions: 3, sectors: 2, regions: 1, bad: false });
  });

  it('returns nothing for an empty portfolio', () => {
    expect(portfolioDiagnostics([], attributes)).toEqual([]);
  });
});
