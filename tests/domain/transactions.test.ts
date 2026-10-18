import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FX_RATES,
  findCategoryBySystemKey,
  monthExpenses,
  toPlain,
  transactionKind,
  type Category,
  type Transaction,
} from '@nestvault/domain';

const categories: Category[] = [
  { id: 'groceries', kind: 'expense', systemKey: 'groceries' },
  { id: 'salary', kind: 'income' },
  { id: 'refunds', kind: 'refund' },
  { id: 'transfer', kind: 'transfer' },
  { id: 'invest', kind: 'invest' },
];
const accounts = [
  { id: 'eur', currency: 'EUR' },
  { id: 'usd', currency: 'USD' },
];

let seq = 0;
const tx = (partial: Partial<Transaction> & Pick<Transaction, 'amount'>): Transaction => ({
  id: `t${++seq}`,
  accountId: 'eur',
  date: '2026-09-10',
  description: 'x',
  ...partial,
});

describe('transactionKind', () => {
  it('uses the transfer flag first, then the category kind, then the sign', () => {
    expect(
      transactionKind(tx({ amount: '-5', transfer: true, categoryId: 'groceries' }), categories),
    ).toBe('transfer');
    expect(transactionKind(tx({ amount: '-5', categoryId: 'salary' }), categories)).toBe('income');
    expect(transactionKind(tx({ amount: '5', categoryId: 'refunds' }), categories)).toBe('refund');
    expect(transactionKind(tx({ amount: '-5' }), categories)).toBe('expense');
    expect(transactionKind(tx({ amount: '5' }), categories)).toBe('income');
    expect(transactionKind(tx({ amount: '-5', categoryId: 'deleted' }), categories)).toBe(
      'expense',
    );
  });
});

describe('monthExpenses', () => {
  const month = [
    tx({ amount: '-100', categoryId: 'groceries' }),
    tx({ amount: '-50.5' }), // uncategorized outflow is an expense
    tx({ amount: '30', categoryId: 'refunds' }),
    tx({ amount: '-200', transfer: true }),
    tx({ amount: '200', transfer: true }),
    tx({ amount: '-300', categoryId: 'invest' }),
    tx({ amount: '2000', categoryId: 'salary' }),
    tx({ amount: '-10', accountId: 'usd', categoryId: 'groceries' }),
    tx({ amount: '-999', categoryId: 'groceries', date: '2026-08-31' }),
  ];

  it('refunds reduce the month expenses; transfers, investments and income are excluded', () => {
    const result = monthExpenses(month, categories, accounts, DEFAULT_FX_RATES, '2026-09');
    // 100 + 50.5 + 10 USD × 0.92 − 30 refund
    expect(toPlain(result.expenses)).toBe('129.7');
    expect(toPlain(result.refunds)).toBe('30');
  });

  it('is zero for a month without transactions', () => {
    expect(
      toPlain(monthExpenses(month, categories, accounts, DEFAULT_FX_RATES, '2027-01').expenses),
    ).toBe('0');
  });
});

describe('findCategoryBySystemKey', () => {
  it('finds a global category by its stable key', () => {
    expect(findCategoryBySystemKey(categories, 'groceries')?.id).toBe('groceries');
    expect(findCategoryBySystemKey(categories, 'nope')).toBeUndefined();
  });
});
