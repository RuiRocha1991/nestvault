import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FX_RATES,
  portfolioCash,
  toPlain,
  type CashAccount,
  type InvestmentAsset,
} from '@nestvault/domain';

import { makeOp } from '../support/investments';

const fund: InvestmentAsset = { id: 'ppr', currency: 'EUR', price: '10' };
const usd: InvestmentAsset = { id: 'aapl', currency: 'USD', price: '200' };
const accounts: CashAccount[] = [
  { id: 'bank', trackCash: true },
  { id: 'debit', trackCash: false },
];
const opts = { asOf: '2026-09-01' };

describe('portfolioCash', () => {
  it('PPR paid by direct debit: buys create no negative cash, dividends and sells land in cash', () => {
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
      makeOp({
        type: 'sell',
        assetId: 'ppr',
        date: '2025-07-01',
        accountId: 'debit',
        qty: '10',
        price: '11',
        fee: '1',
      }),
    ];
    expect(toPlain(portfolioCash(ops, [], accounts, [fund], DEFAULT_FX_RATES, opts))).toBe('114');
  });

  it('counts buys flagged fromCash as an outflow', () => {
    const ops = [
      makeOp({ type: 'div', assetId: 'ppr', date: '2025-06-01', accountId: 'debit', amount: '50' }),
      makeOp({
        type: 'buy',
        assetId: 'ppr',
        date: '2025-07-01',
        accountId: 'debit',
        qty: '3',
        price: '10',
        fromCash: true,
      }),
    ];
    expect(toPlain(portfolioCash(ops, [], accounts, [fund], DEFAULT_FX_RATES, opts))).toBe('20');
  });

  it('ignores operations settled in a tracked account', () => {
    const ops = [
      makeOp({
        type: 'sell',
        assetId: 'ppr',
        date: '2025-07-01',
        accountId: 'bank',
        qty: '10',
        price: '11',
      }),
    ];
    expect(toPlain(portfolioCash(ops, [], accounts, [fund], DEFAULT_FX_RATES, opts))).toBe('0');
  });

  it('treats an operation without an account (or with an unknown one) as untracked', () => {
    const ops = [
      makeOp({ type: 'div', assetId: 'ppr', date: '2025-06-01', amount: '5' }),
      makeOp({ type: 'div', assetId: 'ppr', date: '2025-06-02', accountId: 'gone', amount: '7' }),
    ];
    expect(toPlain(portfolioCash(ops, [], accounts, [fund], DEFAULT_FX_RATES, opts))).toBe('12');
  });

  it('converts foreign-currency dividends to EUR', () => {
    const ops = [makeOp({ type: 'div', assetId: 'aapl', date: '2025-06-01', amount: '10' })];
    expect(toPlain(portfolioCash(ops, [], [], [usd], DEFAULT_FX_RATES, opts))).toBe('9.2');
  });

  it('adds manual moves, filters by portfolio and stops at asOf', () => {
    const ops = [
      makeOp({ type: 'div', assetId: 'ppr', date: '2025-06-01', portfolioId: 'p1', amount: '5' }),
      makeOp({ type: 'div', assetId: 'ppr', date: '2025-06-01', portfolioId: 'p2', amount: '9' }),
      makeOp({ type: 'div', assetId: 'ppr', date: '2027-01-01', portfolioId: 'p1', amount: '100' }),
    ];
    const moves = [
      { portfolioId: 'p1', date: '2025-08-01', amount: '-2' },
      { portfolioId: 'p2', date: '2025-08-01', amount: '40' },
      { portfolioId: 'p1', date: '2027-01-01', amount: '1000' },
    ];
    const p1 = portfolioCash(ops, moves, [], [fund], DEFAULT_FX_RATES, {
      ...opts,
      portfolioIds: ['p1'],
    });
    expect(toPlain(p1)).toBe('3');
    expect(toPlain(portfolioCash(ops, moves, [], [fund], DEFAULT_FX_RATES, opts))).toBe('52');
  });
});

describe('portfolioCash — unknown assets', () => {
  it('ignores operations on assets that are not in the list', () => {
    const ghost = makeOp({ type: 'div', assetId: 'ghost', date: '2025-06-01', amount: '5' });
    expect(toPlain(portfolioCash([ghost], [], [], [fund], DEFAULT_FX_RATES, opts))).toBe('0');
  });
});
