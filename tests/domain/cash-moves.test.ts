import { describe, expect, it } from 'vitest';

import {
  cashShortfall,
  DEFAULT_FX_RATES,
  matchCashMoves,
  moveAmountInAccountCurrency,
  netWorth,
  portfolioCash,
  toPlain,
  type Category,
  type InvestmentAsset,
  type LedgerData,
  type PendingCashMove,
  type Transaction,
} from '@nestvault/domain';

import { makeOp } from '../support/investments';

const categories: Category[] = [
  { id: 'cat-transfer', kind: 'transfer' },
  { id: 'cat-income', kind: 'income' },
];
const accounts = [
  { id: 'bank', currency: 'EUR' },
  { id: 'usd', currency: 'USD' },
];
const move = (partial: Partial<PendingCashMove> = {}): PendingCashMove => ({
  id: 'm1',
  accountId: 'bank',
  date: '2026-03-10',
  amount: '-100',
  ...partial,
});
const line = (partial: Partial<Transaction> = {}): Transaction => ({
  id: 't1',
  accountId: 'bank',
  date: '2026-03-11',
  amount: '100',
  description: 'TRF',
  ...partial,
});

describe('cashShortfall', () => {
  it('is null when the amount fits and the missing part when it does not', () => {
    expect(cashShortfall('500', '500')).toBeNull();
    expect(cashShortfall('500', '120.5')).toBeNull();
    expect(toPlain(cashShortfall('500', '500.01') ?? '0')).toBe('0.01');
    expect(cashShortfall('0', '1')?.toString()).toBe('1');
  });
});

describe('moveAmountInAccountCurrency', () => {
  it('keeps EUR and converts to the account currency, rounded to cents', () => {
    expect(toPlain(moveAmountInAccountCurrency('92', 'EUR', DEFAULT_FX_RATES))).toBe('92');
    expect(toPlain(moveAmountInAccountCurrency('92', 'USD', DEFAULT_FX_RATES))).toBe('100');
    expect(toPlain(moveAmountInAccountCurrency('10', 'USD', DEFAULT_FX_RATES))).toBe('10.87');
  });
});

describe('matchCashMoves', () => {
  it('pairs the inflow of the same cents in the move account and marks the transfer category', () => {
    expect(matchCashMoves([move()], [line()], accounts, categories)).toEqual([
      { moveId: 'm1', transactionId: 't1', categoryId: 'cat-transfer', setCategory: true },
    ]);
  });

  it('does not touch a category chosen by hand', () => {
    const [match] = matchCashMoves(
      [move()],
      [line({ manualCategory: true })],
      accounts,
      categories,
    );
    expect(match).toMatchObject({ transactionId: 't1', setCategory: false });
  });

  it('ignores other amounts, other accounts, outflows and lines outside the window', () => {
    const lines = [
      line({ id: 'cents', amount: '100.01' }),
      line({ id: 'other', accountId: 'usd' }),
      line({ id: 'out', amount: '-100' }),
      line({ id: 'late', date: '2026-03-14' }),
      line({ id: 'early', date: '2026-03-06' }),
    ];
    expect(matchCashMoves([move()], lines, accounts, categories)).toEqual([]);
    expect(
      matchCashMoves([move()], [line({ id: 'edge', date: '2026-03-13' })], accounts, categories),
    ).toHaveLength(1);
    expect(
      matchCashMoves([move()], [line({ id: 'late', date: '2026-03-14' })], accounts, categories, {
        days: 5,
      }),
    ).toHaveLength(1);
  });

  it('takes the closest date, and uses a move and a line once', () => {
    const lines = [
      line({ id: 'far', date: '2026-03-13' }),
      line({ id: 'near', date: '2026-03-10' }),
    ];
    const moves = [move({ id: 'm1' }), move({ id: 'm2' })];
    const matches = matchCashMoves(moves, lines, accounts, categories);
    expect(matches.map((m) => [m.moveId, m.transactionId])).toEqual([
      ['m1', 'near'],
      ['m2', 'far'],
    ]);
    expect(matchCashMoves([move()], [line()], accounts, categories)).toHaveLength(1);
  });

  it('skips lines that are already paired, locked, transfers or linked to another move', () => {
    const lines = [
      line({ id: 'paired', pairId: 'x' }),
      line({ id: 'locked', transferLocked: true }),
      line({ id: 'flagged', transfer: true }),
      line({ id: 'mirror' }),
    ];
    expect(
      matchCashMoves([move()], lines, accounts, categories, { linked: new Set(['mirror']) }),
    ).toEqual([]);
  });

  it('matches cash entering a portfolio with an outflow, and ignores non-EUR accounts', () => {
    const into = move({ amount: '100' });
    expect(
      matchCashMoves([into], [line({ amount: '-100' })], accounts, categories).map(
        (m) => m.transactionId,
      ),
    ).toEqual(['t1']);
    expect(
      matchCashMoves(
        [move({ accountId: 'usd' })],
        [line({ accountId: 'usd' })],
        accounts,
        categories,
      ),
    ).toEqual([]);
  });

  it('leaves a zero move alone and falls back to no category when there is no transfer one', () => {
    expect(
      matchCashMoves([move({ amount: '0' })], [line({ amount: '0' })], accounts, categories),
    ).toEqual([]);
    const [match] = matchCashMoves([move()], [line()], accounts, []);
    expect(match).toMatchObject({ categoryId: null });
  });
});

describe('a cash move and net worth', () => {
  const fund: InvestmentAsset = { id: 'ppr', currency: 'EUR', price: '10' };
  const dividend = makeOp({
    type: 'div',
    assetId: 'ppr',
    date: '2026-03-01',
    amount: '500',
  });
  const base: LedgerData = {
    accounts: [{ id: 'bank', currency: 'EUR', kind: 'other', trackCash: true }],
    transactions: [],
    interestEntries: [],
    ops: [dividend],
    assets: [fund],
    moves: [],
    categories,
    rates: DEFAULT_FX_RATES,
    defaultTax: '28',
  };
  const asOf = '2026-04-01';

  it('keeps net worth when the move is mirrored in the account', () => {
    const before = netWorth(base, asOf, asOf);
    const after = netWorth(
      {
        ...base,
        moves: [{ portfolioId: 'p', date: '2026-03-10', amount: '-120.5' }],
        transactions: [line({ id: 'mirror', date: '2026-03-10', amount: '120.5' })],
      },
      asOf,
      asOf,
    );
    expect(toPlain(after.net)).toBe(toPlain(before.net));
    expect(toPlain(after.cash)).toBe('500');
  });

  it('lowers the portfolio cash without a mirror, until the statement line arrives', () => {
    const moves = [{ portfolioId: 'p', date: '2026-03-10', amount: '-120.5' }];
    const cash = portfolioCash(
      [{ ...dividend, portfolioId: 'p' }],
      moves,
      [{ id: 'bank', trackCash: true }],
      [fund],
      DEFAULT_FX_RATES,
      { asOf, portfolioIds: ['p'] },
    );
    expect(toPlain(cash)).toBe('379.5');
    const pending = netWorth({ ...base, moves }, asOf, asOf);
    expect(toPlain(pending.cash)).toBe('379.5');
    const arrived = netWorth(
      { ...base, moves, transactions: [line({ date: '2026-03-12', amount: '120.5' })] },
      asOf,
      asOf,
    );
    expect(toPlain(arrived.cash)).toBe('500');
  });
});
