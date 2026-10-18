import { describe, expect, it } from 'vitest';

import {
  findCategoryBySystemKey,
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

describe('findCategoryBySystemKey', () => {
  it('finds a global category by its stable key', () => {
    expect(findCategoryBySystemKey(categories, 'groceries')?.id).toBe('groceries');
    expect(findCategoryBySystemKey(categories, 'nope')).toBeUndefined();
  });
});
