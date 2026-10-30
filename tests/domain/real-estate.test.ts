import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FX_RATES,
  expensesByCategory,
  installmentCostSplit,
  loanOutstandingAt,
  matchInstallments,
  monthFlows,
  monthReview,
  netWorth,
  propertyValueAt,
  realEstateAt,
  toPlain,
  type Category,
  type LedgerData,
  type LoanFieldSetting,
  type LoanLiability,
  type PropertyWorth,
  type RealEstateData,
  type Transaction,
} from '@nestvault/domain';

const house: PropertyWorth = {
  purchaseDate: '2020-09-01',
  purchasePrice: '124000',
  sharePct: '100',
  includeInNetWorth: true,
  valuations: [
    { date: '2023-01-10', value: '140000' },
    { date: '2025-06-01', value: '155000' },
  ],
};
const mortgage: LoanLiability = {
  propertyId: 'house',
  startDate: '2020-09-01',
  principal: '111600',
  installments: [
    { dueDate: '2020-10-05', capital: '300' },
    { dueDate: '2020-11-05', capital: '301' },
    { dueDate: '2026-09-05', capital: '148.93' },
  ],
  prepayments: [{ date: '2022-05-01', amount: '5000' }],
};
const data = (over: Partial<RealEstateData> = {}): RealEstateData => ({
  properties: new Map([['house', house]]),
  loans: [mortgage],
  ...over,
});

describe('propertyValueAt', () => {
  it('uses the newest valuation up to the date, then the purchase price before the first one', () => {
    expect(toPlain(propertyValueAt(house, '2026-10-01'))).toBe('155000');
    expect(toPlain(propertyValueAt(house, '2024-01-01'))).toBe('140000');
    expect(toPlain(propertyValueAt(house, '2021-01-01'))).toBe('124000');
  });

  it('is worth nothing before the purchase and when left out of net worth', () => {
    expect(toPlain(propertyValueAt(house, '2020-08-31'))).toBe('0');
    expect(toPlain(propertyValueAt({ ...house, includeInNetWorth: false }, '2026-10-01'))).toBe(
      '0',
    );
  });

  it('counts only the household share (money stays exact)', () => {
    expect(toPlain(propertyValueAt({ ...house, sharePct: '33.3333' }, '2026-10-01'))).toBe(
      '51666.615',
    );
  });
});

describe('loanOutstandingAt', () => {
  it('is the principal less the capital paid and the prepayments, up to the date', () => {
    expect(toPlain(loanOutstandingAt(mortgage, '2020-10-31'))).toBe('111300');
    expect(toPlain(loanOutstandingAt(mortgage, '2021-01-01'))).toBe('110999');
    expect(toPlain(loanOutstandingAt(mortgage, '2022-06-01'))).toBe('105999');
    expect(toPlain(loanOutstandingAt(mortgage, '2026-10-01'))).toBe('105850.07');
  });

  it('is zero before the loan starts and never negative', () => {
    expect(toPlain(loanOutstandingAt(mortgage, '2020-08-31'))).toBe('0');
    const over = { ...mortgage, prepayments: [{ date: '2021-01-01', amount: '999999' }] };
    expect(toPlain(loanOutstandingAt(over, '2022-01-01'))).toBe('0');
  });
});

describe('realEstateAt', () => {
  it('adds the properties and the loans', () => {
    const worth = realEstateAt(data(), '2026-10-01');
    expect(toPlain(worth.realEstate)).toBe('155000');
    expect(toPlain(worth.liabilities)).toBe('105850.07');
  });

  it('leaves out the loan of a property that is left out, and keeps a loan without a property', () => {
    const out = new Map([['house', { ...house, includeInNetWorth: false }]]);
    const car: LoanLiability = {
      propertyId: null,
      startDate: '2025-01-01',
      principal: '10000',
      installments: [],
      prepayments: [],
    };
    const worth = realEstateAt({ properties: out, loans: [mortgage, car] }, '2026-10-01');
    expect(toPlain(worth.realEstate)).toBe('0');
    expect(toPlain(worth.liabilities)).toBe('10000');
  });
});

const categories: Category[] = [
  { id: 'cat-house', kind: 'expense', systemKey: 'mortgage-interest' },
  { id: 'cat-insurance', kind: 'expense', systemKey: 'insurance' },
  { id: 'cat-food', kind: 'expense', systemKey: 'groceries' },
];

const ledger = (over: Partial<LedgerData> = {}): LedgerData => ({
  accounts: [{ id: 'chk', currency: 'EUR', kind: 'other', opening: '10000' }],
  transactions: [],
  interestEntries: [],
  ops: [],
  assets: [],
  moves: [],
  categories,
  rates: DEFAULT_FX_RATES,
  defaultTax: '28',
  ...over,
});

describe('net worth with real estate', () => {
  it('is assets minus liabilities, and the lines are on the result', () => {
    const worth = netWorth(ledger({ realEstate: data() }), '2026-10-01', '2026-10-01');
    expect(toPlain(worth.cash)).toBe('10000');
    expect(toPlain(worth.realEstate)).toBe('155000');
    expect(toPlain(worth.liabilities)).toBe('105850.07');
    expect(toPlain(worth.net)).toBe('59149.93');
    expect(toPlain(worth.byCurrency['EUR'] ?? 0)).toBe('59149.93');
  });

  it('does not change for a pool without real estate (regression)', () => {
    const plain = netWorth(ledger(), '2026-10-01', '2026-10-01');
    const empty = netWorth(
      ledger({ realEstate: { properties: new Map(), loans: [] } }),
      '2026-10-01',
      '2026-10-01',
    );
    for (const worth of [plain, empty]) {
      expect(toPlain(worth.net)).toBe('10000');
      expect(toPlain(worth.realEstate)).toBe('0');
      expect(toPlain(worth.liabilities)).toBe('0');
      expect(Object.keys(worth.byCurrency)).toEqual(['EUR']);
    }
  });
});

const fields: LoanFieldSetting[] = [
  { key: 'lifeInsurance', enabled: true, countsAsExpense: true },
  { key: 'homeInsurance', enabled: true, countsAsExpense: true },
  { key: 'creditInsurance', enabled: false, countsAsExpense: true },
  { key: 'fees', enabled: true, countsAsExpense: true },
  { key: 'stampTax', enabled: true, countsAsExpense: true },
  { key: 'agencyFee', enabled: true, countsAsExpense: false },
];
// The reference month 09/2026: an installment of 388,57 €.
const reference = {
  number: 72,
  dueDate: '2026-09-05',
  capital: '148.93',
  interest: '172.47',
  amounts: { lifeInsurance: '40', homeInsurance: '27.17', creditInsurance: '9' },
};

describe('installmentCostSplit', () => {
  it('splits the reference installment: interest and insurances are expenses, the capital is not', () => {
    expect(installmentCostSplit(reference, fields)).toEqual({
      interest: '172.47',
      insurance: '67.17',
      capital: '148.93',
    });
  });

  it('puts fees, taxes and expense fields with the interest; a disabled or non-expense field adds nothing', () => {
    const split = installmentCostSplit(
      {
        ...reference,
        amounts: { ...reference.amounts, fees: '2', stampTax: '0.5', agencyFee: '30' },
      },
      fields,
    );
    expect(split).toEqual({ interest: '174.97', insurance: '67.17', capital: '148.93' });
  });
});

describe('the expense rule for a linked installment', () => {
  const split = installmentCostSplit(reference, fields);
  const debit: Transaction = {
    id: 'pay',
    accountId: 'chk',
    date: '2026-09-05',
    amount: '-388.57',
    description: 'PRESTACAO',
    categoryId: 'cat-food',
    installment: split,
  };
  const groceries: Transaction = {
    id: 'food',
    accountId: 'chk',
    date: '2026-09-10',
    amount: '-50',
    description: 'SUPERMERCADO',
    categoryId: 'cat-food',
  };

  it('counts 239,64 € of the 388,57 € (capital 148,93 € excluded) and reports the capital apart', () => {
    const [flow] = monthFlows(ledger({ transactions: [debit] }), ['2026-09']);
    expect(toPlain(flow?.expenses ?? 0)).toBe('239.64');
    expect(toPlain(flow?.loanCapital ?? 0)).toBe('148.93');
    // Savings are what is left of the income, so the capital is not lost as an expense.
    expect(toPlain(flow?.savings ?? 0)).toBe('-239.64');
  });

  it('files the interest and the insurances under their own categories', () => {
    const rows = expensesByCategory(ledger({ transactions: [debit, groceries] }), '2026-09');
    const value = (id: string) => toPlain(rows.find((row) => row.categoryId === id)?.value ?? 0);
    expect(value('cat-house')).toBe('172.47');
    expect(value('cat-insurance')).toBe('67.17');
    expect(value('cat-food')).toBe('50');
  });

  it('shows the capital in the month review', () => {
    const review = monthReview(ledger({ transactions: [debit] }), '2026-09', '2026-10-01');
    expect(toPlain(review.expenses)).toBe('239.64');
    expect(toPlain(review.loanCapital)).toBe('148.93');
  });

  it('is unchanged without a link: the whole debit is an expense (regression)', () => {
    const plain = { ...debit, installment: null };
    const [flow] = monthFlows(ledger({ transactions: [plain] }), ['2026-09']);
    expect(toPlain(flow?.expenses ?? 0)).toBe('388.57');
    expect(toPlain(flow?.loanCapital ?? 0)).toBe('0');
  });

  it('ignores a split on a credit or a transfer', () => {
    const credit: Transaction = { ...debit, id: 'c', amount: '388.57', categoryId: null };
    const transfer: Transaction = { ...debit, id: 't', transfer: true };
    const [flow] = monthFlows(ledger({ transactions: [credit, transfer] }), ['2026-09']);
    expect(toPlain(flow?.expenses ?? 0)).toBe('0');
    expect(toPlain(flow?.loanCapital ?? 0)).toBe('0');
  });
});

describe('matchInstallments', () => {
  const installments = [
    { id: 'i1', dueDate: '2026-08-05', total: '388.57' },
    { id: 'i2', dueDate: '2026-09-05', total: '388.57' },
  ];

  it('pairs each installment with the closest debit of the same amount within 5 days', () => {
    const matches = matchInstallments(installments, [
      { id: 'late', date: '2026-09-08', amount: '-388.57' },
      { id: 'exact', date: '2026-09-05', amount: '-388.57' },
      { id: 'august', date: '2026-08-04', amount: '-388.58' },
    ]);
    expect(matches).toEqual([
      { installmentId: 'i1', transactionId: 'august' },
      { installmentId: 'i2', transactionId: 'exact' },
    ]);
  });

  it('refuses a debit too far in time, with the wrong amount, or a credit; a debit is used once', () => {
    expect(
      matchInstallments(installments, [
        { id: 'far', date: '2026-09-11', amount: '-388.57' },
        { id: 'wrong', date: '2026-09-05', amount: '-388.63' },
        { id: 'credit', date: '2026-09-05', amount: '388.57' },
      ]),
    ).toEqual([]);
    const once = matchInstallments(
      [
        { id: 'a', dueDate: '2026-09-05', total: '100' },
        { id: 'b', dueDate: '2026-09-06', total: '100' },
      ],
      [{ id: 'only', date: '2026-09-05', amount: '-100' }],
    );
    expect(once).toEqual([{ installmentId: 'a', transactionId: 'only' }]);
  });
});
