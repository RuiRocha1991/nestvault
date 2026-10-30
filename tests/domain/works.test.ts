import { describe, expect, it } from 'vitest';

import {
  depositAmount,
  paymentDelayDays,
  projectTotals,
  propertyWorkTotals,
  upcomingByMonth,
  type WorkPhase,
} from '@nestvault/domain';

// The kitchen of the owner's spreadsheet: four phases, all paid.
const KITCHEN: WorkPhase[] = [
  { amount: '4900', status: 'paid', plannedDate: '2022-03-01', paidDate: '2022-03-04' },
  { amount: '2460', status: 'paid', plannedDate: '2022-04-01', paidDate: '2022-03-29' },
  { amount: '1230', status: 'paid', plannedDate: '2022-05-01', paidDate: '2022-05-01' },
  { amount: '576', status: 'paid', plannedDate: '2022-06-01', paidDate: '2022-06-10' },
];

describe('projectTotals', () => {
  it('the kitchen: 4 phases of 4 900 + 2 460 + 1 230 + 576 = 9 166 € budgeted and paid, 0 outstanding', () => {
    expect(projectTotals('9166', KITCHEN)).toEqual({
      budget: '9166',
      planned: '9166',
      paid: '9166',
      outstanding: '0',
      unplanned: '0',
      phases: 4,
      paidPhases: 4,
    });
  });

  it('counts only paid phases as paid, and what is left of the budget as outstanding', () => {
    const totals = projectTotals('5000', [
      { amount: '1000', status: 'paid', paidDate: '2025-01-01' },
      { amount: '2000', status: 'planned', plannedDate: '2026-12-01' },
    ]);
    expect(totals).toMatchObject({
      paid: '1000',
      planned: '3000',
      outstanding: '4000',
      unplanned: '2000',
    });
  });

  it('is exact where floats are not (0.1 + 0.2) and never goes below zero', () => {
    expect(
      projectTotals('0.3', [
        { amount: '0.1', status: 'paid', paidDate: '2025-01-01' },
        { amount: '0.2', status: 'paid', paidDate: '2025-01-02' },
      ]),
    ).toMatchObject({ paid: '0.3', outstanding: '0' });
    expect(
      projectTotals('100', [{ amount: '150', status: 'paid', paidDate: '2025-01-01' }]),
    ).toMatchObject({ paid: '150', outstanding: '0', unplanned: '0' });
  });

  it('a project without phases has everything outstanding and unplanned', () => {
    expect(projectTotals('800', [])).toMatchObject({
      paid: '0',
      outstanding: '800',
      unplanned: '800',
      phases: 0,
    });
  });
});

describe('propertyWorkTotals', () => {
  it('adds the projects and counts them by status', () => {
    const paid = (amount: string): WorkPhase => ({
      amount,
      status: 'paid',
      paidDate: '2025-01-01',
    });
    const totals = propertyWorkTotals([
      { budget: '9166', status: 'done', phases: KITCHEN },
      { budget: '5000', status: 'done', phases: [paid('5000')] },
      { budget: '7905.46', status: 'done', phases: [paid('7905.46')] },
      { budget: '0.00', status: 'planned', phases: [] },
      { budget: '2000', status: 'in_progress', phases: [{ amount: '500', status: 'planned' }] },
    ]);
    expect(totals).toEqual({
      projects: 5,
      byStatus: { planned: 1, in_progress: 1, done: 3 },
      budget: '24071.46',
      paid: '22071.46',
      outstanding: '2000',
    });
  });

  it('the reference: 4 projects of 22 071,46 € budgeted and paid, nothing outstanding', () => {
    const paid = (amount: string): WorkPhase => ({
      amount,
      status: 'paid',
      paidDate: '2025-01-01',
    });
    const totals = propertyWorkTotals([
      { budget: '9166', status: 'done', phases: KITCHEN },
      { budget: '5000', status: 'done', phases: [paid('5000')] },
      { budget: '4500', status: 'done', phases: [paid('4500')] },
      { budget: '3405.46', status: 'done', phases: [paid('3405.46')] },
    ]);
    expect(totals).toMatchObject({
      projects: 4,
      budget: '22071.46',
      paid: '22071.46',
      outstanding: '0',
    });
  });

  it('is empty without projects', () => {
    expect(propertyWorkTotals([])).toMatchObject({
      projects: 0,
      budget: '0',
      paid: '0',
      outstanding: '0',
    });
  });
});

describe('deposit and delays', () => {
  it('a 30 % deposit of 9 166 € is 2 749,80 €, rounded to cents', () => {
    expect(depositAmount('9166', '30')).toBe('2749.8');
    expect(depositAmount('1000.01', '33.3333')).toBe('333.34');
  });

  it('paid late is positive, early negative, same day zero, unknown without both dates', () => {
    expect(paymentDelayDays('2022-03-01', '2022-03-04')).toBe(3);
    expect(paymentDelayDays('2022-04-01', '2022-03-29')).toBe(-3);
    expect(paymentDelayDays('2022-05-01', '2022-05-01')).toBe(0);
    expect(paymentDelayDays(null, '2022-05-01')).toBeNull();
    expect(paymentDelayDays('2022-05-01', undefined)).toBeNull();
  });
});

describe('upcomingByMonth', () => {
  const row = (
    id: string,
    amount: string,
    status: 'planned' | 'paid',
    plannedDate: string | null,
  ) => ({
    phase: id,
    amount,
    status,
    plannedDate,
  });

  it('groups the unpaid phases by the month they are planned for, oldest first', () => {
    expect(
      upcomingByMonth([
        row('c', '300', 'planned', '2026-12-20'),
        row('a', '100', 'planned', '2026-11-03'),
        row('b', '250.5', 'planned', '2026-11-28'),
      ]),
    ).toEqual([
      { month: '2026-11', amount: '350.5', phases: ['a', 'b'] },
      { month: '2026-12', amount: '300', phases: ['c'] },
    ]);
  });

  it('leaves out paid phases and phases without a date', () => {
    expect(
      upcomingByMonth([
        row('paid', '100', 'paid', '2026-11-03'),
        row('undated', '100', 'planned', null),
      ]),
    ).toEqual([]);
  });
});
