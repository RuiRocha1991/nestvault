import { describe, expect, it } from 'vitest';

import type { DepositRow } from '@nestvault/db';
import { DEFAULT_FX_RATES, type InvestmentAsset } from '@nestvault/domain';
import {
  AccountsScreenDto,
  buildAccountsScreen,
  type AccountDto,
  type ScreenInput,
} from '@nestvault/services';

import { makeOp } from '../support/investments';

const TODAY = '2026-10-21';
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function account(partial: Partial<AccountDto> & Pick<AccountDto, 'id' | 'type' | 'name'>) {
  return {
    institution: null,
    iban: null,
    currency: 'EUR',
    opening: '0',
    openingDate: null,
    trackCash: true,
    groupName: null,
    portfolioId: null,
    rate: null,
    xtbAccountNo: null,
    holderIds: [],
    subAccounts: [],
    balance: '0',
    balanceEur: '0',
    ...partial,
  } satisfies AccountDto;
}

function input(partial: Partial<ScreenInput>): ScreenInput {
  return {
    today: TODAY,
    accounts: [],
    depositRows: [],
    transactions: [],
    interestEntries: [],
    ops: [],
    assets: [],
    moves: [],
    rates: DEFAULT_FX_RATES,
    defaultTax: '28',
    ...partial,
  };
}

describe('accounts screen: savings account (Trade Republic reference values)', () => {
  const tr = account({
    id: ID(1),
    type: 'savings',
    name: 'Trade Republic',
    opening: '5088.6',
    openingDate: '2025-01-01',
    rate: '2',
    balance: '5285.98',
    balanceEur: '5285.98',
  });
  const entries = [
    { id: ID(11), accountId: ID(1), date: '2025-03-01', amount: '96.86' },
    { id: ID(12), accountId: ID(1), date: '2026-03-01', amount: '100.52' },
  ];
  const screen = buildAccountsScreen(input({ accounts: [tr], interestEntries: entries }));
  const card = screen.accounts[0];

  it('shows the balance, 12-month interest and total interest', () => {
    expect(card?.balance).toBe('5285.98');
    expect(card?.interest?.last12Months).toBe('100.52');
    expect(card?.interest?.total).toBe('197.38');
    expect(card?.interest?.recent.map((row) => row.source)).toEqual(['manual', 'manual']);
    expect(card?.interest?.recent[0]?.date).toBe('2026-03-01');
  });

  it('has an effective rate and no deposit or brokerage block', () => {
    expect(Number(card?.interest?.effectiveRate)).toBeGreaterThan(1);
    expect(card?.term).toBeNull();
    expect(card?.brokerage).toBeNull();
  });

  it('totals the EUR balance per type and parses as the response schema', () => {
    expect(screen.totalsEur).toEqual({
      checking: '0',
      savings: '5285.98',
      term_deposit: '0',
      brokerage: '0',
    });
    expect(AccountsScreenDto.parse(screen)).toEqual(screen);
  });
});

describe('accounts screen: brokerage account (XTB reference values)', () => {
  const xtb = account({
    id: ID(2),
    type: 'brokerage',
    name: 'XTB',
    currency: 'USD',
    xtbAccountNo: '50611139',
    balance: '11.25',
    balanceEur: '10.35',
  });
  const etf: InvestmentAsset = { id: 'etf', currency: 'USD', price: '135.062' };
  const ops = [
    makeOp({
      type: 'buy',
      assetId: 'etf',
      date: '2025-01-10',
      accountId: ID(2),
      qty: '10',
      price: '120',
    }),
    makeOp({
      type: 'div',
      assetId: 'etf',
      date: '2025-06-10',
      accountId: ID(2),
      amount: '34',
      gross: '40',
      tax: '6',
    }),
    makeOp({
      type: 'div',
      assetId: 'etf',
      date: '2025-12-10',
      accountId: ID(2),
      amount: '26.06',
      gross: '30.75',
      tax: '4.69',
    }),
    makeOp({
      type: 'div',
      assetId: 'etf',
      date: '2026-02-10',
      accountId: ID(2),
      amount: '4.24',
      gross: '0',
      tax: '-4.24',
    }),
  ];
  const deposits = [
    { id: 't1', accountId: ID(2), date: '2025-01-01', amount: '1284.39' },
  ] as unknown as ScreenInput['transactions'];
  const card = buildAccountsScreen(
    input({ accounts: [xtb], ops, assets: [etf], transactions: deposits }),
  ).accounts[0];

  it('reports gross dividends, taxes, refunds and net in the account currency', () => {
    expect(card?.brokerage?.dividends).toEqual({
      gross: '70.75',
      tax: '10.69',
      refund: '4.24',
      net: '64.3',
      net12Months: '30.3',
    });
  });

  it('reports the value of the positions, the cash flows and the movements', () => {
    expect(card?.brokerage?.valueBy).toEqual({ USD: '1350.62' });
    expect(card?.brokerage?.positions).toBe(1);
    expect(card?.brokerage?.buys).toBe('1200');
    expect(card?.brokerage?.deposits).toBe('1284.39');
    expect(card?.movements).toBe(1);
  });

  it('leaves the dividend block out of an account without dividends', () => {
    const quiet = buildAccountsScreen(
      input({ accounts: [xtb], ops: ops.slice(0, 1), assets: [etf] }),
    ).accounts[0];
    expect(quiet?.brokerage?.dividends).toBeNull();
  });
});

describe('accounts screen: term deposit (next payment and maturity)', () => {
  const dp = account({
    id: ID(3),
    type: 'term_deposit',
    name: 'DP BPI 12M trimestral',
    rate: '2.5',
    balance: '5067.62',
    balanceEur: '5067.62',
  });
  const row = {
    id: ID(30),
    poolId: ID(99),
    accountId: ID(3),
    productId: null,
    capital: '5000',
    start: '2026-01-10',
    rate: '2.5',
    payN: 3,
    payU: 'm',
    termN: 12,
    termU: 'm',
    capitalize: false,
    tax: null,
    payToAccountId: null,
    fundFromAccountId: null,
  } as unknown as DepositRow;
  const card = buildAccountsScreen(input({ accounts: [dp], depositRows: [row] })).accounts[0];

  it('gives maturity, next payment, tax and progress', () => {
    expect(card?.term).toMatchObject({
      maturity: '2027-01-10',
      tax: '28',
      scheduled: true,
      capital: '5000',
      next: { date: '2027-01-10' },
      progress: 78,
    });
  });

  it('lists the next payment first and then the paid ones, newest first', () => {
    const payments = card?.term?.payments ?? [];
    expect(payments.map((payment) => [payment.date, payment.status])).toEqual([
      ['2027-01-10', 'planned'],
      ['2026-10-10', 'paid'],
      ['2026-07-10', 'paid'],
      ['2026-04-10', 'paid'],
    ]);
    // 5000 × 2,5% × 90 days / 365 = 30,82 gross; 22,19 net of 28% tax.
    expect(payments.at(-1)).toMatchObject({ days: 90, gross: '30.82', net: '22.19' });
  });

  it('sums the gross interest, the tax withheld and the net received', () => {
    const { gross, withheld, net } = card?.term ?? { gross: '', withheld: '', net: '' };
    expect(Number(gross) - Number(withheld)).toBeCloseTo(Number(net), 4);
    expect(Number(net)).toBeGreaterThan(60);
  });
});
