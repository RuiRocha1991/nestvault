import { describe, expect, it } from 'vitest';

import { detectTransfers, type Category, type Transaction } from '@nestvault/domain';

const categories: Category[] = [
  { id: 'cat-transfer', kind: 'transfer' },
  { id: 'cat-invest', kind: 'invest' },
];
const accounts = [
  { id: 'a', currency: 'EUR' },
  { id: 'b', currency: 'EUR' },
  { id: 'c', currency: 'EUR' },
  { id: 'broker', currency: 'EUR', isBrokerage: true },
  { id: 'usd', currency: 'USD' },
];

let seq = 0;
const tx = (
  partial: Partial<Transaction> & Pick<Transaction, 'amount' | 'accountId' | 'date'>,
): Transaction => ({
  id: `t${++seq}`,
  description: 'x',
  ...partial,
});

describe('detectTransfers', () => {
  it('pairs an outflow with the same cents in another EUR account within 3 days', () => {
    const out = tx({ id: 'out', accountId: 'a', date: '2026-09-01', amount: '-250.00' });
    const inn = tx({ id: 'in', accountId: 'b', date: '2026-09-04', amount: '250' });
    expect(detectTransfers([out, inn], accounts, categories)).toEqual([
      {
        outflowId: 'out',
        inflowId: 'in',
        categoryId: 'cat-transfer',
        setOutflowCategory: true,
        setInflowCategory: true,
      },
    ]);
  });

  it('does not pair across currencies, the same account, other cents or more than 3 days', () => {
    const out = tx({ accountId: 'a', date: '2026-09-01', amount: '-250' });
    const cases = [
      tx({ accountId: 'usd', date: '2026-09-01', amount: '250' }),
      tx({ accountId: 'a', date: '2026-09-01', amount: '250' }),
      tx({ accountId: 'b', date: '2026-09-01', amount: '250.01' }),
      tx({ accountId: 'b', date: '2026-09-05', amount: '250' }),
    ];
    for (const inflow of cases)
      expect(detectTransfers([out, inflow], accounts, categories)).toEqual([]);
  });

  it('honours a different window', () => {
    const out = tx({ id: 'o', accountId: 'a', date: '2026-09-01', amount: '-10' });
    const inn = tx({ id: 'i', accountId: 'b', date: '2026-09-05', amount: '10' });
    expect(detectTransfers([out, inn], accounts, categories, { days: 4 })).toHaveLength(1);
    expect(detectTransfers([out, inn], accounts, categories, { days: 1 })).toHaveLength(0);
  });

  it('picks the closest date, and uses each inflow once', () => {
    const early = tx({ id: 'o1', accountId: 'a', date: '2026-09-01', amount: '-10' });
    const later = tx({ id: 'o2', accountId: 'a', date: '2026-09-03', amount: '-10' });
    const far = tx({ id: 'in-far', accountId: 'b', date: '2026-09-04', amount: '10' });
    const near = tx({ id: 'in-near', accountId: 'c', date: '2026-09-03', amount: '10' });
    const pairs = detectTransfers([later, early, far, near], accounts, categories);
    // o1 is handled first: |09-01 → 09-03| = 2 beats |09-01 → 09-04| = 3
    expect(pairs.map((p) => [p.outflowId, p.inflowId])).toEqual([
      ['o1', 'in-near'],
      ['o2', 'in-far'],
    ]);
  });

  it('uses the investment category when the destination is a brokerage account', () => {
    const out = tx({ id: 'o', accountId: 'a', date: '2026-09-01', amount: '-500' });
    const inn = tx({ id: 'i', accountId: 'broker', date: '2026-09-01', amount: '500' });
    expect(detectTransfers([out, inn], accounts, categories)[0]?.categoryId).toBe('cat-invest');
  });

  it('skips paired and locked transactions and never overrides a manual category', () => {
    const out = tx({
      id: 'o',
      accountId: 'a',
      date: '2026-09-01',
      amount: '-10',
      manualCategory: true,
    });
    const inn = tx({ id: 'i', accountId: 'b', date: '2026-09-01', amount: '10' });
    const [pair] = detectTransfers([out, inn], accounts, categories);
    expect(pair).toMatchObject({ setOutflowCategory: false, setInflowCategory: true });
    expect(detectTransfers([{ ...out, pairId: 'x' }, inn], accounts, categories)).toEqual([]);
    expect(detectTransfers([out, { ...inn, transferLocked: true }], accounts, categories)).toEqual(
      [],
    );
  });

  it('same-day outflows compete in input order for a single inflow', () => {
    const first = tx({ id: 'first', accountId: 'a', date: '2026-09-01', amount: '-10' });
    const second = tx({ id: 'second', accountId: 'c', date: '2026-09-01', amount: '-10' });
    const inn = tx({ id: 'in', accountId: 'b', date: '2026-09-01', amount: '10' });
    const pairs = detectTransfers([first, second, inn], accounts, categories);
    expect(pairs.map((p) => p.outflowId)).toEqual(['first']);
  });

  it('treats an unknown account as EUR', () => {
    const out = tx({ id: 'o', accountId: 'ghost', date: '2026-09-01', amount: '-10' });
    const inn = tx({ id: 'i', accountId: 'a', date: '2026-09-01', amount: '10' });
    expect(detectTransfers([out, inn], accounts, categories)).toHaveLength(1);
  });
});
