import { describe, expect, it } from 'vitest';

import type {
  LoanEventRow,
  LoanFieldRow,
  LoanInstallmentRow,
  LoanRow,
  PropertyRow,
  WorksPaymentRow,
  WorksProjectRow,
} from '@nestvault/db';
import { fieldsWithValues, planImport, type PlanState } from '@nestvault/services';

import {
  installmentRow,
  mortgageWorkbookResponse,
  realEstateResponse,
  type RealEstateRow,
} from '../support/real-estate-imports';

// The plan is the one place that decides what an import does; the preview and the commit both use
// it. These tests run it against states built by hand: no database.

const ID = '0192f3a1-0000-7000-8000-000000000001';
const loan = { id: ID, termMonths: 480, propertyId: ID } as LoanRow;
const property = {
  id: ID,
  deedCost: '0.0000',
  imt: '0.0000',
  stampDuty: '0.0000',
  registrationCost: '0.0000',
  bankFees: '0.0000',
} as PropertyRow;
const field = (key: string, enabled: boolean) =>
  ({ key, label: key, enabled, countsAsExpense: true, defaultAmount: null }) as LoanFieldRow;
const fields = [
  field('lifeInsurance', true),
  field('homeInsurance', true),
  field('creditInsurance', false),
  field('fees', false),
  field('stampTax', false),
];

const emptyState = (patch: Partial<PlanState> = {}): PlanState => ({
  loan,
  property,
  installments: [],
  prepayments: [],
  fields,
  works: [],
  payments: [],
  today: '2026-11-01',
  ...patch,
});

const stored = (number: number, patch: Partial<LoanInstallmentRow> = {}) =>
  ({
    id: `0192f3a1-0000-7000-8000-0000000001${String(number).padStart(2, '0')}`,
    number,
    dueDate: `2026-${String(number).padStart(2, '0')}-05`,
    capital: '100.0000',
    interest: '20.0000',
    fees: '0.0000',
    stampTax: '0.0000',
    lifeInsurance: '0.0000',
    homeInsurance: '0.0000',
    creditInsurance: '0.0000',
    status: 'paid',
    source: 'manual',
    ...patch,
  }) as LoanInstallmentRow;

const options = { update: true };

describe('planImport: the reference workbook', () => {
  const response = mortgageWorkbookResponse();

  it('creates all 92 rows but the CPI ones, which are read and not stored', () => {
    const plan = planImport(response, emptyState(), options);
    expect(plan.installments.create).toHaveLength(73);
    expect(plan.prepayments.create).toHaveLength(1);
    expect(plan.works.create).toHaveLength(4);
    expect(plan.payments.create).toHaveLength(8);
    expect(plan.inflation).toBe(6);
    expect(plan.missing).toEqual({ loan: false, property: false });
  });

  it('switches on the fields that have values and are off', () => {
    const plan = planImport(response, emptyState(), options);
    expect(plan.enableFields.sort()).toEqual(['creditInsurance', 'fees', 'stampTax']);
    expect(fieldsWithValues(response.rows).sort()).toEqual([
      'creditInsurance',
      'fees',
      'homeInsurance',
      'lifeInsurance',
      'stampTax',
    ]);
  });

  it('records installments due by today as paid and later ones as scheduled', () => {
    const plan = planImport(response, emptyState({ today: '2026-06-01' }), options);
    const status = (number: number) =>
      plan.installments.create.find((row) => row.number === number)?.status;
    expect(status(1)).toBe('paid');
    expect(status(69)).toBe('paid'); // 05/2026
    expect(status(70)).toBe('scheduled'); // due 06/2026, after today
    expect(plan.installments.create.every((row) => row.source === 'import')).toBe(true);
  });

  it('prepayment: reduces the term and takes effect from the next month', () => {
    const [event] = planImport(response, emptyState(), options).prepayments.create;
    expect(event).toMatchObject({
      kind: 'prepayment',
      date: '2023-02-01',
      effectiveFrom: '2023-03-01',
      amount: '15000',
      effect: 'reduce_term',
    });
  });

  it('acquisition costs fill a property that has none', () => {
    const plan = planImport(response, emptyState(), options);
    expect(plan.costs.action).toBe('fill');
    expect(plan.costs.values).toEqual({
      deedCost: '915',
      imt: '631.86',
      stampDuty: '992',
      bankFees: '20.85',
    });
  });

  it('works are keyed by name and the payment phases by project', () => {
    const plan = planImport(response, emptyState(), options);
    expect(plan.works.create.map((w) => w.key)).toEqual([
      'kitchen refit',
      'air conditioning',
      'bathroom works',
      'wardrobes',
    ]);
    expect(plan.works.create[0]?.values).toMatchObject({
      budget: '9120.46',
      depositPct: '30',
      status: 'done',
      description: null,
      notes: null,
    });
    expect(plan.payments.create.every((p) => p.projectId === null)).toBe(true);
  });
});

describe('planImport: a second import adds nothing', () => {
  it('leaves installments, prepayments, works, phases and costs alone', () => {
    const response = realEstateResponse(
      [
        installmentRow(1),
        installmentRow(2),
        { kind: 'prepayment', date: '2026-02-01', amount: '500', fee: null },
        {
          kind: 'work',
          name: 'Kitchen',
          supplier: 'Supplier A',
          budget: '1000',
          deposit_pct: '30',
          status: 'done',
          start_date: null,
          planned_end: null,
        },
        {
          kind: 'work_payment',
          work: 'Kitchen',
          description: 'Deposit',
          amount: '300',
          planned_date: '2026-01-10',
          paid_date: '2026-01-12',
          status: 'paid',
        },
      ],
      'x',
      { deed: '915', imt: '0', stamp_duty: '0', registration: '0', bank_fees: '0' },
    );
    const state = emptyState({
      installments: [stored(1), stored(2)],
      prepayments: [{ date: '2026-02-01', amount: '500.0000', kind: 'prepayment' } as LoanEventRow],
      works: [
        {
          id: ID,
          name: 'kitchen',
          supplier: 'Supplier A',
          budget: '1000.0000',
          depositPct: '30.0000',
          status: 'done',
          startDate: null,
          plannedEnd: null,
          description: 'my words',
          notes: 'my notes',
        } as WorksProjectRow,
      ],
      payments: [
        {
          id: ID,
          projectId: ID,
          description: 'deposit',
          amount: '300.0000',
          plannedDate: '2026-01-10',
          paidDate: '2026-01-12',
          status: 'paid',
          transactionId: null,
        } as WorksPaymentRow,
      ],
      property: { ...property, deedCost: '915.0000' },
    });
    const plan = planImport(response, state, options);
    expect(plan.installments).toMatchObject({ create: [], update: [], unchanged: 2 });
    expect(plan.prepayments).toEqual({ create: [], unchanged: 1 });
    expect(plan.works).toMatchObject({ create: [], update: [], unchanged: 1 });
    expect(plan.payments).toMatchObject({ create: [], update: [], unchanged: 1 });
    expect(plan.costs.action).toBe('unchanged');
  });
});

describe('planImport: existing rows', () => {
  const different = realEstateResponse([installmentRow(1, { capital: '150' })]);

  it('updates figures when asked and keeps the status and the source', () => {
    const state = emptyState({ installments: [stored(1, { source: 'manual', status: 'paid' })] });
    const plan = planImport(different, state, { update: true });
    expect(plan.installments.update).toHaveLength(1);
    expect(plan.installments.update[0]?.values).toMatchObject({
      capital: '150',
      status: 'paid',
      source: 'manual',
    });
  });

  it('leaves them alone when update is off', () => {
    const plan = planImport(different, emptyState({ installments: [stored(1)] }), {
      update: false,
    });
    expect(plan.installments).toMatchObject({ create: [], update: [], unchanged: 1 });
  });

  it('only fills costs that are zero when update is off; update overwrites', () => {
    const response = realEstateResponse([], 'x', {
      deed: '915',
      imt: '100',
      stamp_duty: '0',
      registration: '0',
      bank_fees: '0',
    });
    const state = emptyState({ property: { ...property, deedCost: '800.0000' } });
    expect(planImport(response, state, { update: false }).costs).toEqual({
      action: 'fill',
      values: { imt: '100' },
    });
    expect(planImport(response, state, { update: true }).costs).toEqual({
      action: 'update',
      values: { deedCost: '915', imt: '100' },
    });
  });

  it('never changes a phase that is linked to a bank movement', () => {
    const response = realEstateResponse([
      {
        kind: 'work_payment',
        work: 'Kitchen',
        description: 'Deposit',
        amount: '300',
        planned_date: '2026-01-10',
        paid_date: '2026-01-15',
        status: 'paid',
      },
    ]);
    const state = emptyState({
      works: [{ id: ID, name: 'Kitchen' } as WorksProjectRow],
      payments: [
        {
          id: ID,
          projectId: ID,
          description: 'Deposit',
          amount: '300.0000',
          plannedDate: '2026-01-10',
          paidDate: '2026-01-12',
          status: 'paid',
          transactionId: ID,
        } as WorksPaymentRow,
      ],
    });
    const plan = planImport(response, state, options);
    expect(plan.payments).toMatchObject({ update: [], kept: 1, create: [] });
  });

  it('two identical phases in one file are two phases', () => {
    const phase: RealEstateRow = {
      kind: 'work_payment',
      work: 'Kitchen',
      description: 'Instalment',
      amount: '100',
      planned_date: null,
      paid_date: null,
      status: 'planned',
    };
    const plan = planImport(realEstateResponse([phase, phase]), emptyState(), options);
    expect(plan.payments.create).toHaveLength(2);
    // the project is made from its phases
    expect(plan.works.create[0]?.values).toMatchObject({
      name: 'Kitchen',
      budget: '200',
      status: 'planned',
    });
  });
});

describe('planImport: rows that cannot be stored', () => {
  it('rejects installments beyond the term and repeated numbers', () => {
    const plan = planImport(
      realEstateResponse([installmentRow(481), installmentRow(2), installmentRow(2)]),
      emptyState(),
      options,
    );
    expect(plan.installments.rejected).toBe(2);
    expect(plan.installments.create.map((row) => row.number)).toEqual([2]);
  });

  it('rejects negative amounts, a deposit above 100 % and a name that is too long', () => {
    const work = (patch: object): RealEstateRow => ({
      kind: 'work',
      name: 'Kitchen',
      supplier: null,
      budget: '100',
      deposit_pct: null,
      status: 'planned',
      start_date: null,
      planned_end: null,
      ...patch,
    });
    const plan = planImport(
      realEstateResponse([
        installmentRow(1, { interest: '-1' }),
        work({ deposit_pct: '120' }),
        work({ name: 'x'.repeat(81) }),
        work({ start_date: '2026-02-01', planned_end: '2026-01-01' }),
      ]),
      emptyState(),
      options,
    );
    expect(plan.installments.rejected).toBe(1);
    expect(plan.works.rejected).toBe(3);
  });

  it('rejects a paid phase without a date and a planned one with a paid date', () => {
    const phase = (patch: object): RealEstateRow => ({
      kind: 'work_payment',
      work: 'Kitchen',
      description: 'Deposit',
      amount: '100',
      planned_date: null,
      paid_date: null,
      status: 'planned',
      ...patch,
    });
    const plan = planImport(
      realEstateResponse([phase({ status: 'paid' }), phase({ paid_date: '2026-01-01' })]),
      emptyState(),
      options,
    );
    expect(plan.payments.rejected).toBe(2);
  });

  it('strips control characters from names the household will read', () => {
    const plan = planImport(
      realEstateResponse([
        {
          kind: 'work',
          name: 'Kit\u0000chen\n',
          supplier: null,
          budget: '1',
          deposit_pct: null,
          status: 'planned',
          start_date: null,
          planned_end: null,
        },
      ]),
      emptyState(),
      options,
    );
    expect(plan.works.create[0]?.values.name).toBe('Kit chen');
  });
});

describe('planImport: nothing to import into', () => {
  it('asks for the loan and the property the file needs', () => {
    const plan = planImport(
      mortgageWorkbookResponse(),
      emptyState({ loan: null, property: null }),
      options,
    );
    expect(plan.missing).toEqual({ loan: true, property: true });
    expect(plan.installments.create).toEqual([]);
  });

  it('a works-only file needs no loan', () => {
    const plan = planImport(
      realEstateResponse([
        {
          kind: 'work_payment',
          work: 'Kitchen',
          description: 'Deposit',
          amount: '10',
          planned_date: null,
          paid_date: null,
          status: 'planned',
        },
      ]),
      emptyState({ loan: null }),
      options,
    );
    expect(plan.missing).toEqual({ loan: false, property: false });
  });
});
