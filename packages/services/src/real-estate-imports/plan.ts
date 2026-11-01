import type {
  InstallmentValues,
  LoanEventRow,
  LoanEventValues,
  LoanFieldRow,
  LoanInstallmentRow,
  LoanRow,
  PropertyRow,
  WorksPaymentRow,
  WorksPaymentValues,
  WorksProjectRow,
  WorksProjectValues,
} from '@nestvault/db';
import { defaultEffectiveFrom, dec, toPlain } from '@nestvault/domain';

import type { RealEstateParserResponse } from '../imports/parser-client';

// What a real estate file would change, decided in one pure place so that the preview and the
// commit can never disagree. Nothing here talks to the database: the service loads the current
// state, asks for the plan, and the commit applies exactly that plan.
//
// Idempotency (NES-102): an installment is identified by (loan, number), a prepayment by (loan,
// date, amount), a works project by (property, name), a payment phase by (project, description,
// amount, planned date, occurrence in the file) and the acquisition costs by the property. A row
// that is already there is left alone unless "update existing" is on, and then only the figures
// the file states change. Never touched: notes, descriptions, the status of an installment or of a
// works project (the household moves those by hand), the dates a works project already has, a
// payment phase marked paid by hand (the file may mark a planned phase paid, never the opposite)
// and links to bank movements.

type Row = RealEstateParserResponse['rows'][number];
type Of<K extends Row['kind']> = Extract<Row, { kind: K }>;

export const BUILTIN_KEYS = [
  'lifeInsurance',
  'homeInsurance',
  'creditInsurance',
  'fees',
  'stampTax',
] as const;
export type BuiltinKey = (typeof BUILTIN_KEYS)[number];

export interface PlanState {
  loan: LoanRow | null;
  property: PropertyRow | null;
  installments: readonly LoanInstallmentRow[];
  /** The prepayment events of the loan. */
  prepayments: readonly LoanEventRow[];
  fields: readonly LoanFieldRow[];
  works: readonly WorksProjectRow[];
  /** The phases of `works`. */
  payments: readonly WorksPaymentRow[];
  /** `yyyy-mm-dd`: installments due on or before it are recorded as paid. */
  today: string;
}

export interface PlanOptions {
  update: boolean;
}

export interface CostValues {
  deedCost?: string;
  imt?: string;
  stampDuty?: string;
  registrationCost?: string;
  bankFees?: string;
}

export interface Plan {
  installments: {
    create: InstallmentValues[];
    update: { id: string; values: InstallmentValues }[];
    unchanged: number;
    rejected: number;
  };
  /** Built-in installment fields the file has values for and the loan has switched off. */
  enableFields: BuiltinKey[];
  prepayments: { create: LoanEventValues[]; unchanged: number; rejected: number };
  costs: {
    action: 'none' | 'fill' | 'update' | 'unchanged';
    values: CostValues;
    /** Costs of the file that are negative or do not fit the column: skipped. */
    rejected: number;
  };
  works: {
    /** `key` ties the payments to a project that does not exist yet. */
    create: { key: string; values: WorksProjectValues }[];
    update: { id: string; values: WorksProjectValues }[];
    unchanged: number;
    rejected: number;
  };
  payments: {
    create: { projectId: string | null; projectKey: string; values: WorksPaymentValues }[];
    update: { projectId: string; id: string; values: WorksPaymentValues }[];
    unchanged: number;
    rejected: number;
    /** Differ from the file but are linked to a bank movement: left as they are. */
    kept: number;
  };
  /** CPI rows are read and shown; the app has no store for them (the card is editable). */
  inflation: number;
  /** Rows that need a loan or a property the import was not given. */
  missing: { loan: boolean; property: boolean };
}

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/g;
const clean = (text: string | null): string | null => {
  if (text === null) return null;
  const value = text.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  return value === '' ? null : value;
};
const inRange = (text: string | null, max: number): text is string =>
  text !== null && text.length >= 1 && text.length <= max;

export const nameKey = (text: string): string => text.normalize('NFC').toLowerCase().trim();

const money = (value: string): string => toPlain(dec(value).toDecimalPlaces(4));
/** numeric(18,4): 14 integer digits at most. */
const fits = (amount: string): boolean => !dec(amount).isNegative() && dec(amount).lt(1e14);
const same = (a: string | null, b: string | null): boolean =>
  a === null || b === null ? a === b : dec(a).eq(dec(b));

const FIELD_OF: Record<BuiltinKey, FieldColumn> = {
  lifeInsurance: 'life_insurance',
  homeInsurance: 'home_insurance',
  creditInsurance: 'credit_insurance',
  fees: 'fees',
  stampTax: 'stamp_tax',
};
type FieldColumn = 'life_insurance' | 'home_insurance' | 'credit_insurance' | 'fees' | 'stamp_tax';

/** The built-in fields that at least one installment of the file has a value for. */
export function fieldsWithValues(rows: readonly Row[]): BuiltinKey[] {
  const installments = rows.filter((row): row is Of<'installment'> => row.kind === 'installment');
  return BUILTIN_KEYS.filter((key) =>
    installments.some((row) => !dec(row[FIELD_OF[key]]).isZero()),
  );
}

function installmentValues(row: Of<'installment'>, today: string): InstallmentValues | null {
  const values: InstallmentValues = {
    number: row.number,
    dueDate: row.due_date,
    capital: money(row.capital),
    interest: money(row.interest),
    fees: money(row.fees),
    stampTax: money(row.stamp_tax),
    lifeInsurance: money(row.life_insurance),
    homeInsurance: money(row.home_insurance),
    creditInsurance: money(row.credit_insurance),
    status: row.due_date <= today ? 'paid' : 'scheduled',
    source: 'import',
  };
  const amounts = [
    values.capital,
    values.interest,
    values.fees,
    values.stampTax,
    values.lifeInsurance,
    values.homeInsurance,
    values.creditInsurance,
  ];
  return amounts.every(fits) ? values : null;
}

const AMOUNT_KEYS = [
  'capital',
  'interest',
  'fees',
  'stampTax',
  'lifeInsurance',
  'homeInsurance',
  'creditInsurance',
] as const;

function planInstallments(rows: readonly Of<'installment'>[], state: PlanState, o: PlanOptions) {
  const out: Plan['installments'] = { create: [], update: [], unchanged: 0, rejected: 0 };
  const loan = state.loan;
  if (!loan) return out;
  const byNumber = new Map(state.installments.map((item) => [item.number, item]));
  const seen = new Set<number>();
  for (const row of rows) {
    const values = installmentValues(row, state.today);
    if (!values || row.number > loan.termMonths || seen.has(row.number)) {
      out.rejected += 1;
      continue;
    }
    seen.add(row.number);
    const current = byNumber.get(row.number);
    if (!current) {
      out.create.push(values);
      continue;
    }
    const equal =
      current.dueDate === values.dueDate && AMOUNT_KEYS.every((k) => same(current[k], values[k]));
    if (equal || !o.update) {
      out.unchanged += 1;
      continue;
    }
    // The status and the source stay: they say whether the bank debit was matched and by whom.
    out.update.push({
      id: current.id,
      values: { ...values, status: current.status, source: current.source },
    });
  }
  return out;
}

function planPrepayments(rows: readonly Of<'prepayment'>[], state: PlanState) {
  const out: Plan['prepayments'] = { create: [], unchanged: 0, rejected: 0 };
  if (!state.loan) return out;
  const known = state.prepayments.map((event) => ({ date: event.date, amount: event.amount }));
  for (const row of rows) {
    const amount = money(row.amount);
    const fee = row.fee === null ? null : money(row.fee);
    if (dec(amount).lte(0) || !fits(amount) || (fee !== null && !fits(fee))) {
      out.rejected += 1;
      continue;
    }
    const index = known.findIndex(
      (k) => k.date === row.date && k.amount !== null && same(k.amount, amount),
    );
    if (index >= 0) {
      known.splice(index, 1); // a second identical prepayment in the file is a second event
      out.unchanged += 1;
      continue;
    }
    out.create.push({
      kind: 'prepayment',
      date: row.date,
      effectiveFrom: defaultEffectiveFrom('prepayment', row.date),
      amount,
      fee,
      effect: 'reduce_term',
      indexValue: null,
      spread: null,
      annualRate: null,
      newInstallment: null,
      termMonths: null,
    });
  }
  return out;
}

const COST_COLUMNS = [
  ['deed', 'deedCost'],
  ['imt', 'imt'],
  ['stamp_duty', 'stampDuty'],
  ['registration', 'registrationCost'],
  ['bank_fees', 'bankFees'],
] as const;

function planCosts(
  costs: RealEstateParserResponse['meta']['acquisition_costs'],
  state: PlanState,
  o: PlanOptions,
): Plan['costs'] {
  if (!costs || !state.property) return { action: 'none', values: {}, rejected: 0 };
  const values: CostValues = {};
  let rejected = 0;
  for (const [fromFile, column] of COST_COLUMNS) {
    const next = money(costs[fromFile]);
    if (!fits(next)) {
      rejected += 1;
      continue;
    }
    if (dec(next).isZero()) continue;
    const current = state.property[column];
    if (same(current, next)) continue;
    if (dec(current).isZero() || o.update) values[column] = next;
  }
  const changed = Object.keys(values).length > 0;
  if (!changed) return { action: 'unchanged', values, rejected };
  const overwrites = (Object.keys(values) as (keyof CostValues)[]).some(
    (column) => !dec(state.property?.[column] ?? 0).isZero(),
  );
  return { action: overwrites ? 'update' : 'fill', values, rejected };
}

function workValues(
  row: Of<'work'>,
  propertyId: string,
  current: WorksProjectRow | undefined,
): WorksProjectValues | null {
  const name = clean(row.name);
  const supplier = clean(row.supplier);
  const budget = money(row.budget);
  const deposit = row.deposit_pct === null ? null : money(row.deposit_pct);
  if (!inRange(name, 80) || (supplier !== null && !inRange(supplier, 80))) return null;
  if (!fits(budget)) return null;
  if (deposit !== null && (dec(deposit).isNegative() || dec(deposit).gt(100))) return null;
  if (row.start_date && row.planned_end && row.planned_end < row.start_date) return null;
  return {
    propertyId,
    name,
    // The description and the notes are the household's own words: an import never writes them.
    description: current?.description ?? null,
    supplier,
    budget,
    depositPct: deposit,
    // The household moves the status by hand and sets its own dates: the file only fills dates.
    status: current?.status ?? row.status,
    startDate: current ? (current.startDate ?? row.start_date) : row.start_date,
    plannedEnd: current ? (current.plannedEnd ?? row.planned_end) : row.planned_end,
    notes: current?.notes ?? null,
  };
}

function planWorksAndPayments(
  works: readonly Of<'work'>[],
  payments: readonly Of<'work_payment'>[],
  state: PlanState,
  o: PlanOptions,
) {
  const outWorks: Plan['works'] = { create: [], update: [], unchanged: 0, rejected: 0 };
  const outPayments: Plan['payments'] = {
    create: [],
    update: [],
    unchanged: 0,
    rejected: 0,
    kept: 0,
  };
  const property = state.property;
  if (!property) return { works: outWorks, payments: outPayments };

  const existing = new Map(state.works.map((project) => [nameKey(project.name), project]));
  const known = new Set<string>(); // project keys that exist or will exist
  const byProject = new Map<string, WorksPaymentRow[]>();
  for (const payment of state.payments) {
    byProject.set(payment.projectId, [...(byProject.get(payment.projectId) ?? []), payment]);
  }

  for (const row of works) {
    const current = existing.get(nameKey(clean(row.name) ?? ''));
    const values = workValues(row, property.id, current);
    if (!values) {
      outWorks.rejected += 1;
      continue;
    }
    const key = nameKey(values.name);
    if (known.has(key)) {
      outWorks.rejected += 1; // the same project twice in the file
      continue;
    }
    known.add(key);
    if (!current) {
      outWorks.create.push({ key, values });
      continue;
    }
    const equal =
      same(current.budget, values.budget) &&
      same(current.depositPct, values.depositPct) &&
      current.supplier === values.supplier &&
      current.startDate === values.startDate &&
      current.plannedEnd === values.plannedEnd;
    if (equal || !o.update) outWorks.unchanged += 1;
    else outWorks.update.push({ id: current.id, values });
  }

  // Phases: group by project; a project the file does not list is created from its phases.
  const implicit = new Map<string, { name: string; rows: Of<'work_payment'>[] }>();
  const seen = new Map<string, number>();
  for (const row of payments) {
    const projectName = clean(row.work);
    const description = clean(row.description);
    const amount = money(row.amount);
    const valid =
      inRange(projectName, 80) &&
      inRange(description, 120) &&
      dec(amount).gt(0) &&
      fits(amount) &&
      (row.status === 'paid' ? row.paid_date !== null : row.paid_date === null);
    if (!valid) {
      outPayments.rejected += 1;
      continue;
    }
    const projectKey = nameKey(projectName);
    if (!known.has(projectKey) && !existing.has(projectKey)) {
      const group = implicit.get(projectKey) ?? { name: projectName, rows: [] };
      group.rows.push(row);
      implicit.set(projectKey, group);
    }
    const project = existing.get(projectKey);
    const values: WorksPaymentValues = {
      description,
      amount,
      plannedDate: row.planned_date,
      paidDate: row.paid_date,
      status: row.status,
    };
    const phaseKey = `${projectKey}|${nameKey(description)}|${amount}|${row.planned_date ?? ''}`;
    const occurrence = seen.get(phaseKey) ?? 0;
    seen.set(phaseKey, occurrence + 1);
    const candidates = (project ? (byProject.get(project.id) ?? []) : []).filter(
      (payment) =>
        `${projectKey}|${nameKey(payment.description)}|${money(payment.amount)}|${payment.plannedDate ?? ''}` ===
        phaseKey,
    );
    const current = candidates[occurrence];
    if (!current) {
      outPayments.create.push({ projectId: project?.id ?? null, projectKey, values });
      continue;
    }
    const equal = current.status === values.status && current.paidDate === values.paidDate;
    // The file may only advance a planned phase to paid: a phase the household marked paid, or one
    // linked to a bank movement, keeps what it has.
    const advances = current.status === 'planned' && values.status === 'paid';
    if (equal || !o.update) {
      outPayments.unchanged += 1;
    } else if (current.transactionId || !advances) {
      outPayments.kept += 1;
    } else if (project) {
      outPayments.update.push({ projectId: project.id, id: current.id, values });
    }
  }

  for (const [key, group] of implicit) {
    const total = group.rows.reduce((sum, row) => sum.plus(money(row.amount)), dec(0));
    const paid = group.rows.filter((row) => row.status === 'paid').length;
    outWorks.create.push({
      key,
      values: {
        propertyId: property.id,
        name: group.name,
        description: null,
        supplier: null,
        budget: money(toPlain(total)),
        depositPct: null,
        status: paid === group.rows.length ? 'done' : paid > 0 ? 'in_progress' : 'planned',
        startDate: null,
        plannedEnd: null,
        notes: null,
      },
    });
  }
  return { works: outWorks, payments: outPayments };
}

/** Decides what the file would do to the loan and the property it is imported into. */
export function planImport(
  response: RealEstateParserResponse,
  state: PlanState,
  options: PlanOptions,
): Plan {
  const rows = response.rows;
  const installments = rows.filter((row): row is Of<'installment'> => row.kind === 'installment');
  const prepayments = rows.filter((row): row is Of<'prepayment'> => row.kind === 'prepayment');
  const works = rows.filter((row): row is Of<'work'> => row.kind === 'work');
  const payments = rows.filter((row): row is Of<'work_payment'> => row.kind === 'work_payment');
  const { works: plannedWorks, payments: plannedPayments } = planWorksAndPayments(
    works,
    payments,
    state,
    options,
  );
  const wanted = fieldsWithValues(installments);
  const switchedOff = new Set(state.fields.filter((f) => !f.enabled).map((f) => f.key));
  return {
    installments: planInstallments(installments, state, options),
    enableFields: state.loan ? wanted.filter((key) => switchedOff.has(key)) : [],
    prepayments: planPrepayments(prepayments, state),
    costs: planCosts(response.meta.acquisition_costs, state, options),
    works: plannedWorks,
    payments: plannedPayments,
    inflation: rows.filter((row) => row.kind === 'inflation').length,
    missing: {
      loan: !state.loan && (installments.length > 0 || prepayments.length > 0),
      property:
        !state.property &&
        (works.length > 0 || payments.length > 0 || response.meta.acquisition_costs !== null),
    },
  };
}
