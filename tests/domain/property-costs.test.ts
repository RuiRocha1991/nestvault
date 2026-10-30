import { describe, expect, it } from 'vitest';

import {
  annualAmount,
  costOccurrences,
  costTotals,
  dueDates,
  expectedByMonth,
  isDueDate,
  occurrenceKey,
  type CostInput,
  type InstallmentInsurance,
} from '@nestvault/domain';

const PROPERTY = 'property-1';

const annualHome: CostInput = {
  id: 'home',
  propertyId: PROPERTY,
  kind: 'insurance_home',
  amount: '143.5',
  intervalMonths: 12,
  startDate: '2021-03-15',
  endDate: null,
};
const imi: CostInput = {
  id: 'imi',
  propertyId: PROPERTY,
  kind: 'imi',
  amount: '412.5',
  intervalMonths: 12,
  startDate: '2024-04-30',
};
const condo: CostInput = {
  id: 'condo',
  propertyId: PROPERTY,
  kind: 'condominium',
  amount: '35',
  intervalMonths: 1,
  startDate: '2026-01-31',
};

const installment = (dueDate: string, home = '16.5', life = '0'): InstallmentInsurance => ({
  propertyId: PROPERTY,
  dueDate,
  home,
  life,
  credit: '0',
});

describe('dueDates', () => {
  it('puts an annual cost in the right month of the range', () => {
    expect(dueDates(annualHome, '2026-01-01', '2026-12-31')).toEqual(['2026-03-15']);
    expect(dueDates(annualHome, '2026-04-01', '2027-03-14')).toEqual([]);
    expect(dueDates(annualHome, '2026-04-01', '2027-03-15')).toEqual(['2027-03-15']);
  });

  it('is anchored on the start date, so a 31st never drifts after a short month', () => {
    expect(dueDates(condo, '2026-01-01', '2026-05-31')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
  });

  it('starts at the start date and stops at the end date', () => {
    expect(dueDates({ ...condo, endDate: '2026-02-28' }, '2025-01-01', '2026-12-31')).toEqual([
      '2026-01-31',
      '2026-02-28',
    ]);
    expect(dueDates(imi, '2020-01-01', '2024-04-29')).toEqual([]);
  });

  it('handles a custom interval', () => {
    const quarterly = { ...condo, intervalMonths: 3 };
    expect(dueDates(quarterly, '2026-01-01', '2026-12-31')).toEqual([
      '2026-01-31',
      '2026-04-30',
      '2026-07-31',
      '2026-10-31',
    ]);
  });

  it('knows whether a date is one of the due dates', () => {
    expect(isDueDate(annualHome, '2026-03-15')).toBe(true);
    expect(isDueDate(annualHome, '2026-03-16')).toBe(false);
    expect(isDueDate(annualHome, '2020-03-15')).toBe(false);
    expect(isDueDate({ ...annualHome, endDate: '2025-12-31' }, '2026-03-15')).toBe(false);
  });
});

describe('annualAmount', () => {
  it('turns every interval into a year', () => {
    expect(annualAmount('143.5', 12)).toBe('143.5');
    expect(annualAmount('16.5', 1)).toBe('198');
    expect(annualAmount('100', 3)).toBe('400');
    expect(annualAmount('10', 7)).toBe('17.14');
  });

  it('refuses an interval below one month', () => {
    expect(() => annualAmount('1', 0)).toThrow(RangeError);
  });
});

describe('costOccurrences', () => {
  it('marks what a bank debit paid and what is still expected', () => {
    const rows = costOccurrences([imi, annualHome], '2026-01-01', '2026-12-31', {
      paid: new Set([occurrenceKey('home', '2026-03-15')]),
    });
    expect(rows.map((row) => [row.costId, row.dueDate, row.status, row.amount])).toEqual([
      ['home', '2026-03-15', 'paid', '143.5'],
      ['imi', '2026-04-30', 'expected', '412.5'],
    ]);
  });

  it('does not count an insurance twice once the installment carries it (reference: annual until 2023, monthly inside the installment after)', () => {
    // The owner left the annual policy open after it moved into the installment in 2024.
    const installments = [
      installment('2024-01-05'),
      installment('2024-02-05'),
      installment('2024-03-05'),
      installment('2024-04-05'),
    ];
    const rows = costOccurrences([annualHome], '2023-01-01', '2024-12-31', { installments });
    expect(rows.map((row) => [row.dueDate, row.status])).toEqual([
      ['2023-03-15', 'expected'],
      ['2024-03-15', 'covered'],
    ]);
  });

  it('covers the same kind only, in the same property and month', () => {
    const life: CostInput = { ...annualHome, id: 'life', kind: 'insurance_life' };
    const rows = costOccurrences([annualHome, life, imi], '2026-01-01', '2026-12-31', {
      installments: [
        installment('2026-03-05'),
        { ...installment('2026-04-05'), propertyId: 'other-property' },
      ],
    });
    const status = (id: string) => rows.find((row) => row.costId === id)?.status;
    expect(status('home')).toBe('covered');
    // A life policy is not covered by a home insurance in the installment.
    expect(status('life')).toBe('expected');
    // The IMI is never inside an installment, whatever the installments carry.
    expect(status('imi')).toBe('expected');
    // The installment of another property does not cover this one.
    const other = costOccurrences([imi], '2026-01-01', '2026-12-31', {
      installments: [{ ...installment('2026-04-05'), propertyId: 'other-property' }],
    });
    expect(other[0]?.status).toBe('expected');
  });

  it('keeps an occurrence paid even when an installment of that month carries the insurance', () => {
    const rows = costOccurrences([annualHome], '2026-01-01', '2026-12-31', {
      paid: new Set([occurrenceKey('home', '2026-03-15')]),
      installments: [installment('2026-03-05')],
    });
    expect(rows[0]?.status).toBe('paid');
  });

  it('sorts by due date', () => {
    const rows = costOccurrences([imi, condo, annualHome], '2026-03-01', '2026-04-30');
    expect(rows.map((row) => row.dueDate)).toEqual([
      '2026-03-15',
      '2026-03-31',
      '2026-04-30',
      '2026-04-30',
    ]);
  });
});

describe('costTotals', () => {
  it('adds the costs by kind to the installment insurances, each counted once', () => {
    const installments = [installment('2026-01-05', '16.5', '12.34'), installment('2026-02-05')];
    const rows = costOccurrences([annualHome, imi, condo], '2026-01-01', '2026-12-31', {
      paid: new Set([occurrenceKey('imi', '2026-04-30')]),
      installments,
    });
    const totals = costTotals(rows, installments, '2026-01-01', '2026-12-31');
    // The home insurance of March is not inside an installment month, so it counts.
    expect(totals.byKind).toEqual({
      insurance_home: '143.5',
      insurance_life: '0',
      imi: '412.5',
      condominium: '420',
      other: '0',
    });
    expect(totals.paid).toBe('412.5');
    expect(totals.expected).toBe('563.5');
    expect(totals.costs).toBe('976');
    expect(totals.installmentInsurance).toBe('45.34');
    expect(totals.total).toBe('1021.34');
  });

  it('leaves out an occurrence covered by an installment, so the policy counts once', () => {
    const installments = [installment('2026-03-05')];
    const rows = costOccurrences([annualHome], '2026-01-01', '2026-12-31', { installments });
    const totals = costTotals(rows, installments, '2026-01-01', '2026-12-31');
    expect(totals.costs).toBe('0');
    expect(totals.installmentInsurance).toBe('16.5');
    expect(totals.total).toBe('16.5');
  });

  it('counts only the installments and occurrences inside the period', () => {
    const installments = [installment('2025-12-05'), installment('2026-06-05')];
    const rows = costOccurrences([imi], '2025-01-01', '2027-12-31', { installments });
    const totals = costTotals(rows, installments, '2026-01-01', '2026-12-31');
    expect(totals.costs).toBe('412.5');
    expect(totals.installmentInsurance).toBe('16.5');
  });

  it('keeps money exact (0.1 + 0.2)', () => {
    const a: CostInput = { ...imi, id: 'a', amount: '0.1' };
    const b: CostInput = { ...imi, id: 'b', amount: '0.2' };
    const totals = costTotals(
      costOccurrences([a, b], '2026-01-01', '2026-12-31'),
      [],
      '2026-01-01',
      '2026-12-31',
    );
    expect(totals.total).toBe('0.3');
  });
});

describe('expectedByMonth', () => {
  it('groups what is still expected by month, leaving paid and covered ones out', () => {
    const installments = [installment('2026-03-05')];
    const rows = costOccurrences([annualHome, imi, condo], '2026-01-01', '2026-04-30', {
      paid: new Set([occurrenceKey('condo', '2026-01-31')]),
      installments,
    });
    const months = expectedByMonth(rows);
    expect(months.map((month) => [month.month, month.amount])).toEqual([
      ['2026-02', '35'],
      ['2026-03', '35'],
      ['2026-04', '447.5'],
    ]);
    expect(months[2]?.occurrences.map((row) => row.costId).sort()).toEqual(['condo', 'imi']);
  });
});
