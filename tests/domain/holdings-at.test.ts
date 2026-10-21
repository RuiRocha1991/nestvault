import { describe, expect, it } from 'vitest';

import {
  accountBalances,
  accountBalancesAt,
  computeHoldings,
  computeHoldingsAt,
  netWorths,
  type InvestmentAsset,
  type InvestmentOp,
  type LedgerData,
} from '@nestvault/domain';

import { makeOp } from '../support/investments';

const assets: InvestmentAsset[] = [
  {
    id: 'A',
    currency: 'EUR',
    price: '12',
    prices: [
      { date: '2026-01-15', price: '9' },
      { date: '2026-03-15', price: '11' },
    ],
    dps: '1',
    divMonths: [6],
  },
  { id: 'U', currency: 'USD', price: '20', dps: null, divMonths: null },
];

const ops: InvestmentOp[] = [
  makeOp({ type: 'buy', assetId: 'A', date: '2026-01-10', qty: '10', price: '8', fee: '1' }),
  makeOp({ type: 'buy', assetId: 'U', date: '2026-02-01', qty: '5', price: '18' }),
  makeOp({ type: 'sell', assetId: 'A', date: '2026-02-01', qty: '4', price: '10' }),
  makeOp({ type: 'div', assetId: 'A', date: '2026-02-20', amount: '3', gross: '4', tax: '1' }),
  makeOp({ type: 'buy', assetId: 'A', date: '2026-04-02', qty: '2', price: '12' }),
];

const rates = { USD: '0.92' };
const dates = ['2026-01-31', '2026-02-28', '2026-03-31', '2026-05-31'];

describe('computeHoldingsAt', () => {
  it('gives the same holdings as computeHoldings on each date', () => {
    const series = computeHoldingsAt(ops, assets, rates, dates, { today: '2026-05-31' });
    dates.forEach((asOf, i) => {
      const expected = computeHoldings(ops, assets, rates, { asOf, today: '2026-05-31' });
      expect(
        series[i]?.map((h) => [h.key, h.qty.toFixed(), h.value.toFixed(), h.total.toFixed()]),
      ).toEqual(
        expected.map((h) => [h.key, h.qty.toFixed(), h.value.toFixed(), h.total.toFixed()]),
      );
    });
  });

  it('answers in the order the dates are given, whatever it is', () => {
    const shuffled = [dates[2] ?? '', dates[0] ?? '', dates[3] ?? '', dates[1] ?? ''];
    const sorted = computeHoldingsAt(ops, assets, rates, dates, { today: '2026-05-31' });
    const mixed = computeHoldingsAt(ops, assets, rates, shuffled, { today: '2026-05-31' });
    expect(mixed[0]?.map((h) => h.value.toFixed())).toEqual(
      sorted[2]?.map((h) => h.value.toFixed()),
    );
    expect(mixed[1]?.map((h) => h.value.toFixed())).toEqual(
      sorted[0]?.map((h) => h.value.toFixed()),
    );
  });

  it('keeps the positions of a later date out of an earlier one', () => {
    const series = computeHoldingsAt(ops, assets, rates, ['2026-01-05', '2026-12-31'], {
      today: '2026-12-31',
    });
    expect(series[0]).toEqual([]);
    expect(series[1]?.length).toBeGreaterThan(0);
  });
});

describe('netWorths with the balances at hand', () => {
  const data: LedgerData = {
    accounts: [
      { id: 'c', currency: 'EUR', kind: 'other', opening: '100', openingDate: '2026-01-01' },
    ],
    transactions: [
      { id: '1', accountId: 'c', date: '2026-02-10', amount: '50', description: 'x' },
      { id: '2', accountId: 'c', date: '2026-04-10', amount: '-20', description: 'y' },
      { id: '3', accountId: 'c', date: '2027-01-01', amount: '999', description: 'later' },
    ],
    interestEntries: [],
    ops,
    assets,
    moves: [],
    categories: [],
    rates,
    defaultTax: '28',
  };

  it('is the same with precomputed balances, and a movement past the last date is left out', () => {
    const balances = accountBalancesAt(data, dates);
    expect(netWorths(data, dates, '2026-05-31', balances).map((w) => w.net.toFixed())).toEqual(
      netWorths(data, dates, '2026-05-31').map((w) => w.net.toFixed()),
    );
    expect(accountBalances(data, '2026-05-31').get('c')?.toFixed()).toBe('130');
    expect(
      accountBalancesAt(data, ['2026-05-31', '2026-01-31']).map((m) => m.get('c')?.toFixed()),
    ).toEqual(['130', '100']);
  });
});
