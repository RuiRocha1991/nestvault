import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FX_RATES,
  portfolioSummary,
  roundCents,
  toPlain,
  type InvestmentAsset,
  type PortfolioSummaryInput,
  type SummaryAccount,
} from '@nestvault/domain';

import { makeOp, must } from '../support/investments';

const asOf = '2026-09-01';
const opts = { asOf, today: asOf };
const plain = (map: Record<string, { toFixed(): string }>) =>
  Object.fromEntries(Object.entries(map).map(([c, v]) => [c, v.toFixed()]));

function input(partial: Partial<PortfolioSummaryInput>): PortfolioSummaryInput {
  return { ops: [], assets: [], accounts: [], moves: [], rates: DEFAULT_FX_RATES, ...partial };
}

describe('portfolioSummary — XTB account 50611139 (synthetic position)', () => {
  // The repository holds no raw statement. Reference figures from docs/handoff.md: cash 11.25,
  // gross dividends 70.75, tax −10.69, refund +4.24 (USD). The position is chosen so that
  // cash + open positions = 1 361,87 US$, the validated account value (see PR notes).
  const etf: InvestmentAsset = { id: 'etf', currency: 'USD', price: '135.062' };
  const xtb: SummaryAccount = {
    id: 'xtb',
    currency: 'USD',
    trackCash: true,
    isBrokerage: true,
    balance: '11.25',
    interest: '0',
  };
  const ops = [
    makeOp({
      type: 'buy',
      assetId: 'etf',
      date: '2025-01-10',
      accountId: 'xtb',
      qty: '10',
      price: '120',
    }),
    makeOp({
      type: 'div',
      assetId: 'etf',
      date: '2025-06-10',
      accountId: 'xtb',
      amount: '34',
      gross: '40',
      tax: '6',
    }),
    makeOp({
      type: 'div',
      assetId: 'etf',
      date: '2025-12-10',
      accountId: 'xtb',
      amount: '26.06',
      gross: '30.75',
      tax: '4.69',
    }),
    makeOp({
      type: 'div',
      assetId: 'etf',
      date: '2026-02-10',
      accountId: 'xtb',
      amount: '4.24',
      gross: '0',
      tax: '-4.24',
    }),
  ];
  const summary = portfolioSummary(input({ ops, assets: [etf], accounts: [xtb] }), opts);

  it('reports gross dividends, taxes, refunds and cash by currency', () => {
    expect(plain(summary.divGrossBy)).toEqual({ USD: '70.75' });
    expect(plain(summary.taxBy)).toEqual({ USD: '-10.69' });
    expect(plain(summary.refundBy)).toEqual({ USD: '4.24' });
    expect(plain(summary.cashBy)).toEqual({ USD: '11.25', EUR: '0' });
    expect(plain(summary.divsBy)).toEqual({ USD: '64.3' });
  });

  it('values the account at 1 361,87 US$ and builds the profit decomposition', () => {
    expect(plain(summary.valueBy)).toEqual({ USD: '1350.62' });
    expect(plain(summary.valueAllBy)).toEqual({ USD: '1361.87', EUR: '0' });
    // unrealized 150.62 + gross 70.75 − tax 10.69 + refund 4.24
    expect(plain(summary.profitBy)).toEqual({ USD: '214.92' });
    expect(toPlain(roundCents(summary.valueAll))).toBe('1252.92'); // 1361.87 × 0.92
    expect(toPlain(roundCents(summary.netInvested.plus(summary.profit)))).toBe('1252.92');
    expect(summary.profitPct.toNumber()).toBeCloseTo(214.92 / 1146.95, 10);
  });

  it('computes income, positions and the 12-month dividends', () => {
    expect(summary.positions).toBe(1);
    expect(toPlain(summary.divs12)).toBe('27.876'); // (26.06 + 4.24) × 0.92; the June 2025 dividend is older than 12 months
  });
});

describe('portfolioSummary — PPR paid by direct debit', () => {
  const ppr: InvestmentAsset = { id: 'ppr', currency: 'EUR', price: '12' };
  const debit: SummaryAccount = {
    id: 'debit',
    currency: 'EUR',
    trackCash: false,
    isBrokerage: false,
    balance: '999',
    interest: '0',
  };
  const ops = [
    makeOp({
      type: 'buy',
      assetId: 'ppr',
      date: '2025-01-01',
      accountId: 'debit',
      qty: '100',
      price: '10',
    }),
    makeOp({ type: 'div', assetId: 'ppr', date: '2025-06-01', accountId: 'debit', amount: '5' }),
  ];
  const summary = portfolioSummary(input({ ops, assets: [ppr], accounts: [debit] }), opts);

  it('keeps dividends in portfolio cash and never goes negative', () => {
    expect(toPlain(summary.cash)).toBe('5');
    expect(plain(summary.cashBy)).toEqual({ EUR: '5' });
    // the untracked account balance is not added
    expect(plain(summary.valueAllBy)).toEqual({ EUR: '1205' });
  });
});

describe('portfolioSummary — emergency fund linked to a portfolio', () => {
  const stock: InvestmentAsset = { id: 'stock', currency: 'EUR', price: '110' };
  const fund: SummaryAccount = {
    id: 'tr',
    currency: 'EUR',
    trackCash: true,
    isBrokerage: false,
    portfolioId: 'p1',
    balance: '5285.98',
    interest: '197.38',
  };
  const ops = [
    makeOp({
      type: 'buy',
      assetId: 'stock',
      date: '2025-01-01',
      portfolioId: 'p1',
      qty: '10',
      price: '100',
    }),
  ];
  const data = input({ ops, assets: [stock], accounts: [fund] });

  it('is included in the portfolio value and profit', () => {
    const summary = portfolioSummary(data, { ...opts, portfolioIds: ['p1'] });
    expect(plain(summary.cashBy)).toEqual({ EUR: '5285.98' });
    expect(plain(summary.otherBy)).toEqual({ EUR: '197.38' });
    expect(plain(summary.valueAllBy)).toEqual({ EUR: '6385.98' });
    expect(plain(summary.profitBy)).toEqual({ EUR: '297.38' }); // 100 unrealized + 197.38 interest
  });

  it('is counted once, and left out of other portfolios and of a single-account view', () => {
    expect(plain(portfolioSummary(data, { ...opts, portfolioIds: ['p2'] }).cashBy)).toEqual({
      EUR: '0',
    });
    expect(plain(portfolioSummary(data, { ...opts, accountId: 'tr' }).cashBy)).toEqual({});
    expect(plain(portfolioSummary(data, opts).valueAllBy)).toEqual({ EUR: '6385.98' });
  });

  it('does not count a brokerage account that is also linked twice', () => {
    const both: SummaryAccount = { ...fund, isBrokerage: true };
    const withOps = input({
      ops: [{ ...must(ops[0]), accountId: 'tr' }],
      assets: [stock],
      accounts: [both],
    });
    expect(plain(portfolioSummary(withOps, opts).cashBy)).toEqual({ EUR: '5285.98' });
  });
});

describe('portfolioSummary — return and edge cases', () => {
  const stock: InvestmentAsset = { id: 'stock', currency: 'EUR', price: '110', dps: '2' };

  it('xirr of the operations plus the current value', () => {
    const ops = [
      makeOp({ type: 'buy', assetId: 'stock', date: '2025-09-01', qty: '10', price: '100' }),
    ];
    const summary = portfolioSummary(input({ ops, assets: [stock] }), opts);
    expect(summary.irr).toBeCloseTo(0.1, 2); // 1000 → 1100 in a year
    expect(toPlain(summary.gain)).toBe('100');
    expect(toPlain(summary.gainPct)).toBe('0.1');
    expect(toPlain(summary.income)).toBe('20');
    expect(toPlain(summary.yld)).toBe(toPlain(summary.income.div(summary.value)));
  });

  it('is NaN with a history under 30 days and 0 % with nothing invested', () => {
    const young = [
      makeOp({ type: 'buy', assetId: 'stock', date: '2026-08-20', qty: '1', price: '100' }),
    ];
    expect(portfolioSummary(input({ ops: young, assets: [stock] }), opts).irr).toBeNaN();
    const empty = portfolioSummary(input({ assets: [stock] }), opts);
    expect(toPlain(empty.profitPct)).toBe('0');
    expect(toPlain(empty.valueAll)).toBe('0');
    expect(empty.positions).toBe(0);
  });

  it('includes realized sales in the profit and manual moves in cash', () => {
    const ops = [
      makeOp({
        type: 'buy',
        assetId: 'stock',
        date: '2025-01-01',
        portfolioId: 'p1',
        qty: '10',
        price: '100',
      }),
      makeOp({
        type: 'sell',
        assetId: 'stock',
        date: '2025-06-01',
        portfolioId: 'p1',
        qty: '10',
        price: '120',
      }),
    ];
    const moves = [{ portfolioId: 'p1', date: '2025-07-01', amount: '1200' }];
    const summary = portfolioSummary(input({ ops, assets: [stock], moves }), {
      ...opts,
      portfolioIds: ['p1'],
    });
    expect(plain(summary.realizedBy)).toEqual({ EUR: '200' });
    expect(toPlain(summary.cash)).toBe('2400'); // sale proceeds 1200 + move 1200
    expect(plain(summary.profitBy)).toEqual({ EUR: '200' });
  });
});

describe('portfolioSummary — shared brokerage account', () => {
  const etf: InvestmentAsset = { id: 'etf', currency: 'EUR', price: '10' };
  const shared: SummaryAccount = {
    id: 'bk',
    currency: 'EUR',
    trackCash: true,
    isBrokerage: true,
    balance: '100',
    interest: '0',
  };
  const ops = [
    makeOp({
      type: 'buy',
      assetId: 'etf',
      date: '2025-01-01',
      portfolioId: 'p1',
      accountId: 'bk',
      qty: '1',
      price: '10',
    }),
    makeOp({
      type: 'buy',
      assetId: 'etf',
      date: '2027-01-01',
      portfolioId: 'p2',
      accountId: 'bk',
      qty: '1',
      price: '10',
    }),
  ];
  const data = input({ ops, assets: [etf], accounts: [shared] });

  it('counts the cash when the other portfolio only uses it after asOf', () => {
    const summary = portfolioSummary(data, { ...opts, portfolioIds: ['p1'] });
    expect(plain(summary.cashBy)).toEqual({ EUR: '100' });
  });

  it('leaves the cash out once another portfolio already uses the account', () => {
    const summary = portfolioSummary(data, {
      asOf: '2027-06-01',
      today: '2027-06-01',
      portfolioIds: ['p1'],
    });
    expect(plain(summary.cashBy)).toEqual({ EUR: '0' });
  });
});
