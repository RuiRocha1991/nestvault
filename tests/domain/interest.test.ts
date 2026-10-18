import { describe, expect, it } from 'vitest';

import {
  accountInterest,
  interestLast12Months,
  interestTotal,
  isInterestTransaction,
  toPlain,
  type Deposit,
} from '@nestvault/domain';

const asOf = '2026-09-01';

describe('Trade Republic fixture (synthetic entries)', () => {
  // Reference: balance 5 285,98 € (an input here), interest in the last 12 months 100,52 €,
  // total 197,38 €. The entry on 2025-09-01 is exactly 12 months ago and does not count as recent.
  const manual = [
    { id: 'a', date: '2025-03-31', amount: '40.00' },
    { id: 'b', date: '2025-06-30', amount: '36.86' },
    { id: 'c', date: '2025-09-01', amount: '20.00' },
    { id: 'd', date: '2025-12-31', amount: '33.00' },
    { id: 'e', date: '2026-03-31', amount: '33.52' },
    { id: 'f', date: '2026-08-31', amount: '34.00' },
  ];
  const entries = accountInterest({ manual }, asOf, '28');

  it('interest in the last 12 months is 100,52 € and the total 197,38 €', () => {
    expect(toPlain(interestLast12Months(entries, asOf))).toBe('100.52');
    expect(toPlain(interestTotal(entries, asOf))).toBe('197.38');
  });

  it('lists newest first and ignores entries after asOf in the totals', () => {
    expect(entries.map((e) => e.id)).toEqual(['f', 'e', 'd', 'c', 'b', 'a']);
    const future = accountInterest(
      { manual: [...manual, { id: 'z', date: '2027-01-01', amount: '99' }] },
      asOf,
      '28',
    );
    expect(toPlain(interestTotal(future, asOf))).toBe('197.38');
    expect(toPlain(interestLast12Months(future, asOf))).toBe('100.52');
  });
});

describe('isInterestTransaction', () => {
  it('uses the category when there is one', () => {
    const base = { amount: '5', description: 'x' };
    expect(isInterestTransaction({ ...base, category: { kind: 'income', name: 'Juros' } })).toBe(
      true,
    );
    expect(isInterestTransaction({ ...base, category: { kind: 'income', name: 'Salário' } })).toBe(
      false,
    );
    expect(isInterestTransaction({ ...base, category: { kind: 'expense', name: 'Juros' } })).toBe(
      false,
    );
  });

  it('falls back to the description (no accents, whole word) when uncategorized', () => {
    expect(isInterestTransaction({ amount: '5', description: 'Crédito de juros' })).toBe(true);
    expect(isInterestTransaction({ amount: '5', description: 'INTEREST PAYMENT' })).toBe(true);
    expect(isInterestTransaction({ amount: '5', description: 'JUROSITA' })).toBe(false);
  });

  it('never counts negative amounts or internal transfers', () => {
    expect(isInterestTransaction({ amount: '-5', description: 'juros' })).toBe(false);
    expect(isInterestTransaction({ amount: '5', description: 'juros', transfer: true })).toBe(
      false,
    );
  });
});

describe('accountInterest', () => {
  it('adds statement lines to manual entries, skipping those already counted as a deposit interest', () => {
    const entries = accountInterest(
      {
        manual: [{ id: 'm', date: '2026-01-31', amount: '10' }],
        transactions: [
          { id: 't1', date: '2026-02-28', amount: '4', description: 'Juros' },
          {
            id: 't2',
            date: '2026-03-31',
            amount: '4',
            description: 'Juros',
            depositInterest: true,
          },
          { id: 't3', date: '2026-04-30', amount: '50', description: 'Salário' },
        ],
      },
      asOf,
      '28',
    );
    expect(entries.map((e) => [e.id, e.source])).toEqual([
      ['t1', 'statement'],
      ['m', 'manual'],
    ]);
  });

  it('takes the paid periods of a scheduled deposit, ignoring manual entries', () => {
    const deposit: Deposit = {
      id: 'dep',
      capital: '10000',
      rate: '2.5',
      start: '2025-01-15',
      payN: 3,
      payU: 'm',
      termN: 12,
      termU: 'm',
    };
    const entries = accountInterest(
      { deposit, manual: [{ id: 'm', date: '2025-05-01', amount: '999' }] },
      '2025-10-20',
      '28',
    );
    expect(entries.map((e) => [e.date, toPlain(e.amount), e.source])).toEqual([
      ['2025-10-15', '45.78', 'scheduled'],
      ['2025-07-15', '45.08', 'scheduled'],
      ['2025-04-15', '44.38', 'scheduled'],
    ]);
  });
});
