import { describe, expect, it } from 'vitest';

import {
  computeHoldings,
  DEFAULT_FX_RATES,
  dividendsForecast,
  dividendsLast12Months,
  dividendsReceived,
  hasDividends,
  nextMonths,
  toPlain,
  type InvestmentAsset,
} from '@nestvault/domain';

import { makeOp, must } from '../support/investments';

const asOf = '2026-09-15';
const opts = { asOf, today: asOf };
const quarterly: InvestmentAsset = {
  id: 'q',
  currency: 'EUR',
  price: '50',
  dps: '2',
  divMonths: [3, 6, 9, 12],
};
const usdTwice: InvestmentAsset = {
  id: 'u',
  currency: 'USD',
  price: '100',
  dps: '3',
  divMonths: [1, 7],
};
const noMonths: InvestmentAsset = { id: 'n', currency: 'EUR', price: '10', dps: '1' };

describe('dividendsForecast', () => {
  const ops = [
    makeOp({ type: 'buy', assetId: 'q', date: '2025-01-01', qty: '100', price: '40' }),
    makeOp({ type: 'buy', assetId: 'u', date: '2025-01-01', qty: '10', price: '90' }),
    makeOp({ type: 'buy', assetId: 'n', date: '2025-01-01', qty: '10', price: '9' }),
  ];
  const holdings = computeHoldings(ops, [quarterly, usdTwice, noMonths], DEFAULT_FX_RATES, opts);

  it('splits the annual income evenly over the payment months, in EUR', () => {
    const forecast = dividendsForecast(holdings, nextMonths(12, asOf));
    expect(forecast.map((m) => m.month).slice(0, 4)).toEqual([
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    const sep = must(forecast[0]);
    expect(sep.items).toHaveLength(1);
    expect(toPlain(sep.value)).toBe('50'); // 100 × 2 / 4
    const jan = must(forecast.find((m) => m.month === '2027-01'));
    expect(toPlain(jan.value)).toBe('13.8'); // 10 × 3 / 2 × 0.92
    expect(toPlain(must(forecast[1]).value)).toBe('0');
  });

  it('skips closed positions and assets without payment months', () => {
    const closed = computeHoldings(
      [...ops, makeOp({ type: 'sell', assetId: 'q', date: '2026-01-01', qty: '100', price: '50' })],
      [quarterly, usdTwice, noMonths],
      DEFAULT_FX_RATES,
      opts,
    );
    const forecast = dividendsForecast(closed, ['2026-09']);
    expect(toPlain(must(forecast[0]).value)).toBe('0');
  });
});

describe('dividendsReceived and the last 12 months', () => {
  const ops = [
    makeOp({ type: 'div', assetId: 'q', date: '2025-09-15', amount: '1000' }), // exactly 12 months ago: excluded
    makeOp({ type: 'div', assetId: 'q', date: '2025-12-10', amount: '20' }),
    makeOp({ type: 'div', assetId: 'u', date: '2026-07-10', amount: '10', portfolioId: 'p1' }),
    makeOp({ type: 'div', assetId: 'q', date: '2026-07-20', amount: '5', portfolioId: 'p2' }),
    makeOp({ type: 'div', assetId: 'q', date: '2027-01-01', amount: '99' }),
  ];
  const assets = [quarterly, usdTwice];

  it('sums EUR per month in the order asked', () => {
    const received = dividendsReceived(ops, assets, DEFAULT_FX_RATES, [
      '2026-06',
      '2026-07',
      '2025-12',
    ]);
    expect(received.map(toPlain)).toEqual(['0', '14.2', '20']);
  });

  it('can be limited to a portfolio', () => {
    const received = dividendsReceived(ops, assets, DEFAULT_FX_RATES, ['2026-07'], {
      portfolioIds: ['p1'],
    });
    expect(received.map(toPlain)).toEqual(['9.2']);
  });

  it('adds the 12 months before asOf, in EUR and by currency', () => {
    const last = dividendsLast12Months(ops, assets, DEFAULT_FX_RATES, asOf);
    expect(toPlain(last.eur)).toBe('34.2');
    expect(
      Object.fromEntries(Object.entries(last.byCurrency).map(([c, v]) => [c, toPlain(v)])),
    ).toEqual({
      EUR: '25',
      USD: '10',
    });
  });
});

describe('unknown assets', () => {
  it('are ignored, like in the positions', () => {
    const ghost = makeOp({ type: 'div', assetId: 'ghost', date: '2026-07-01', amount: '50' });
    expect(
      dividendsReceived([ghost], [quarterly], DEFAULT_FX_RATES, ['2026-07']).map(toPlain),
    ).toEqual(['0']);
    expect(toPlain(dividendsLast12Months([ghost], [quarterly], DEFAULT_FX_RATES, asOf).eur)).toBe(
      '0',
    );
  });
});

describe('hasDividends', () => {
  const assets = [quarterly, noMonths];
  const buy = (assetId: string) =>
    makeOp({ type: 'buy', assetId, date: '2025-01-01', qty: '10', price: '10' });
  const open = (ops: ReturnType<typeof buy>[]) =>
    computeHoldings(ops, assets, DEFAULT_FX_RATES, opts);

  it('is false for a portfolio without operations (accounts only)', () => {
    expect(hasDividends([], assets, [])).toBe(false);
  });

  it('is false when the positions are not expected to pay and nothing was received', () => {
    const none: InvestmentAsset = {
      id: 'z',
      currency: 'EUR',
      price: '10',
      dps: '0',
      divMonths: [],
    };
    const ops = [buy('z')];
    expect(hasDividends(ops, [none], computeHoldings(ops, [none], DEFAULT_FX_RATES, opts))).toBe(
      false,
    );
  });

  it('is true for an open position that is expected to pay', () => {
    const ops = [buy('q')];
    expect(hasDividends(ops, assets, open(ops))).toBe(true);
  });

  it('is true once a dividend was received, even from a closed position', () => {
    const ops = [
      buy('n'),
      makeOp({ type: 'div', assetId: 'n', date: '2025-06-01', amount: '1' }),
      makeOp({ type: 'sell', assetId: 'n', date: '2025-07-01', qty: '10', price: '10' }),
    ];
    const noIncome: InvestmentAsset = { id: 'n', currency: 'EUR', price: '10', dps: '0' };
    expect(
      hasDividends(ops, [noIncome], computeHoldings(ops, [noIncome], DEFAULT_FX_RATES, opts)),
    ).toBe(true);
  });

  it('only counts the operations inside the scope it is given', () => {
    const ops = [
      makeOp({ type: 'div', assetId: 'n', date: '2025-06-01', amount: '1', portfolioId: 'p1' }),
    ];
    expect(hasDividends(ops, assets, [], { portfolioIds: ['p2'] })).toBe(false);
    expect(hasDividends(ops, assets, [], { portfolioIds: ['p1'] })).toBe(true);
  });
});
