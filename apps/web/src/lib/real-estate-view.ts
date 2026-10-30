import {
  BUILTIN_LOAN_FIELDS,
  RESERVED_LOAN_FIELD_KEYS,
  addMonths,
  contractYear,
  dec,
  repaidPct,
  spentBreakdown,
  sum,
  toPlain,
  type SpentBreakdown,
} from '@nestvault/domain/browser';
import type { PropertyDto, WorkDto, WorkListDto } from '@nestvault/services';

import type { LoanBundle } from '@webapp/server/real-estate';

/** The service DTOs as client components receive them (they never import the services root). */
export type PropertyView = PropertyDto;
export type WorkView = WorkDto;
export type WorkListView = WorkListDto;

/** `rate_review` → `rateReview`: message keys are camelCase. */
export const camelKey = (value: string): string =>
  value.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase());

/** Insurances and the other fields a loan can charge, grouped as the donut groups them. */
const INSURANCE_KEYS = ['lifeInsurance', 'homeInsurance', 'creditInsurance'] as const;

export interface UpcomingInstallment {
  number: number;
  dueDate: string;
  capital: string;
  interest: string;
  /** Insurances and fees of the last installment entered, carried forward. */
  extras: string;
  total: string;
}

export interface LoanFacts {
  /** Installments entered so far. */
  paidCount: number;
  /** Paid plus the ones the plan still has. */
  totalCount: number;
  /** Capital repaid: installments and prepayments. */
  capitalPaid: string;
  /** What the last installment cost in all (capital, interest and fields), or the projection's. */
  payment: string;
  /** Due date of the last installment of the plan. */
  endDate: string | null;
  nextDueDate: string | null;
  repaidPct: string;
  upcoming: UpcomingInstallment[];
}

const UPCOMING = 4;

export function loanFacts(bundle: LoanBundle): LoanFacts {
  const { loan, schedule, installments } = bundle;
  const last = installments.at(-1);
  const projected = schedule.schedule.filter((row) => row.source === 'projected');
  // What the bank charges besides capital and interest: the last installment's, carried forward.
  const extras = last ? dec(last.total).minus(last.capital).minus(last.interest) : dec(0);
  const capitalPaid = dec(loan.paid.capital).plus(loan.prepaid);
  return {
    paidCount: installments.length,
    totalCount: installments.length + loan.remainingInstallments,
    capitalPaid: toPlain(capitalPaid),
    payment: last ? last.total : (projected[0]?.payment ?? '0'),
    endDate: schedule.schedule.at(-1)?.dueDate ?? null,
    nextDueDate: projected[0]?.dueDate ?? null,
    repaidPct: repaidPct(loan.principal, capitalPaid),
    upcoming: projected.slice(0, UPCOMING).map((row) => ({
      number: row.number,
      dueDate: row.dueDate,
      capital: row.capital,
      interest: row.interest,
      extras: toPlain(extras),
      total: toPlain(dec(row.payment).plus(extras)),
    })),
  };
}

export interface PropertyFigures {
  value: string | null;
  valueDate: string | null;
  outstanding: string;
  /** Latest valuation minus what is still owed; `null` until there is a valuation. */
  equity: string | null;
  spent: SpentBreakdown;
  capitalPaid: string;
  principal: string;
  repaidPct: string;
  paidCount: number;
  totalCount: number;
}

const fieldTotal = (bundles: readonly LoanBundle[], keys: readonly string[]): string =>
  toPlain(
    sum(
      bundles.flatMap(({ loan }) =>
        Object.entries(loan.paid.fields)
          .filter(([key]) => keys.includes(key))
          .map(([, amount]) => amount),
      ),
    ),
  );

/** The headline numbers of a property across its loans (mockups 27 and 28). */
export function propertyFigures(
  property: PropertyDto,
  bundles: readonly LoanBundle[],
  works: WorkListDto | null,
): PropertyFigures {
  const outstanding = sum(bundles.map(({ loan }) => loan.outstanding));
  const value = property.latestValuation?.value ?? null;
  const facts = bundles.map(loanFacts);
  const capitalPaid = sum(facts.map((f) => f.capitalPaid));
  const principal = sum(bundles.map(({ loan }) => loan.principal));
  const insuranceKeys: readonly string[] = INSURANCE_KEYS;
  const otherKeys = bundles.flatMap(({ loan }) =>
    Object.keys(loan.paid.fields).filter((key) => !insuranceKeys.includes(key)),
  );
  const spent = spentBreakdown({
    downPayment: property.downPayment,
    capitalPaid,
    works: works?.byProperty.find((row) => row.propertyId === property.id)?.paid ?? '0',
    interest: sum(bundles.map(({ loan }) => loan.paid.interest)),
    insurances: fieldTotal(bundles, INSURANCE_KEYS),
    acquisitionCosts: property.costs.total,
    feesAndTax: fieldTotal(bundles, otherKeys),
  });
  return {
    value,
    valueDate: property.latestValuation?.date ?? null,
    outstanding: toPlain(outstanding),
    equity: value === null ? null : toPlain(dec(value).minus(outstanding)),
    spent,
    capitalPaid: toPlain(capitalPaid),
    principal: toPlain(principal),
    repaidPct: repaidPct(principal, capitalPaid),
    paidCount: facts.reduce((total, f) => total + f.paidCount, 0),
    totalCount: facts.reduce((total, f) => total + f.totalCount, 0),
  };
}

export interface YearBar {
  year: number;
  /** Calendar year in which the contract year starts (the chart's label). */
  label: string;
  capital: number;
  interest: number;
  projected: boolean;
}

/** Capital and interest per contract year: 12 installments make one, whatever the calendar says. */
export function yearBars(bundle: LoanBundle): YearBar[] {
  const groups = new Map<number, YearBar & { actual: number }>();
  for (const row of bundle.schedule.schedule) {
    const year = contractYear(row.number);
    const bar = groups.get(year) ?? {
      year,
      label: row.dueDate.slice(0, 4),
      capital: 0,
      interest: 0,
      projected: true,
      actual: 0,
    };
    bar.capital += Number(row.capital);
    bar.interest += Number(row.interest);
    if (row.source === 'actual') bar.actual += 1;
    groups.set(year, bar);
  }
  return [...groups.values()]
    .sort((a, b) => a.year - b.year)
    .map(({ actual, ...bar }) => ({ ...bar, projected: actual === 0 }));
}

/** `2020-09-01` + contract year 2 → the first and last month of that year, as `yyyy-mm` pairs. */
export function yearPeriod(firstDueDate: string, year: number): { from: string; to: string } {
  const from = addMonths(firstDueDate, (year - 1) * 12);
  return { from: from.slice(0, 7), to: addMonths(from, 11).slice(0, 7) };
}

/** `2026-09-01` → `09/2026`. */
export const monthYearOf = (date: string): string => `${date.slice(5, 7)}/${date.slice(0, 4)}`;

/** The default consumer price series (INE, yearly change in percent) used for the inflation card. */
export const DEFAULT_CPI: readonly { year: number; ratePct: string }[] = [
  { year: 2021, ratePct: '1.27' },
  { year: 2022, ratePct: '7.83' },
  { year: 2023, ratePct: '4.3' },
  { year: 2024, ratePct: '2.4' },
  { year: 2025, ratePct: '2.3' },
];

/** The rates after the purchase year: buying in 2020 is hit by 2021 on. */
export const ratesSince = (
  rates: readonly { year: number; ratePct: string }[],
  purchaseDate: string,
) => rates.filter((rate) => rate.year > Number(purchaseDate.slice(0, 4)));

/** A field of the loan as the table sees it: its column, and whether it holds any value at all. */
export interface InstallmentField {
  key: string;
  label: string;
  kind: 'builtin' | 'custom';
  enabled: boolean;
  countsAsExpense: boolean;
  defaultAmount: string | null;
  appliesFrom: string | null;
  /** Some installment entered has a value in it (disabling it asks first; the values stay). */
  hasValues: boolean;
}

export interface InstallmentRow {
  number: number;
  dueDate: string;
  capital: string;
  interest: string;
  /** Every field by key, enabled or not (a disabled one keeps its values but does not count). */
  amounts: Record<string, string>;
  /** Sum of the enabled fields: what the bank charges besides capital and interest. */
  extras: string;
  /** Capital + interest + the enabled fields. */
  total: string;
  /** Installments left after this one. */
  remaining: number;
  status: 'paid' | 'projected';
}

type EnteredInstallment = LoanBundle['installments'][number];

const BUILTIN_KEYS: readonly string[] = BUILTIN_LOAN_FIELDS;

/** A builtin field is a column of the installment; a custom one is only read from `custom`. */
const amountIn = (item: EnteredInstallment, field: { key: string; kind: string }): string =>
  field.kind === 'custom' || !BUILTIN_KEYS.includes(field.key)
    ? (item.custom[field.key] ?? '0')
    : ((item as unknown as Record<string, string>)[field.key] ?? '0');

const hasAmount = (value: string | undefined): boolean =>
  value !== undefined && !dec(value).isZero();

/** The loan's fields, builtin ones first, with whether any installment entered holds a value. */
export function installmentFields(bundle: LoanBundle): InstallmentField[] {
  return [...bundle.loan.fields]
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'builtin' ? -1 : 1))
    .map((field) => ({
      ...field,
      hasValues: bundle.installments.some((item) => hasAmount(amountIn(item, field))),
    }));
}

/** The default amount applies to a due date from `appliesFrom` on (always, without one). */
const defaultApplies = (field: InstallmentField, dueDate: string): boolean =>
  field.defaultAmount !== null && (field.appliesFrom === null || field.appliesFrom <= dueDate);

/**
 * Every installment of a loan, entered ones first and the projection after them (mockup 29).
 * A projected row carries the amounts of the last installment entered; a field with a default
 * amount fills the projected rows from its start date instead. Only enabled fields count in the
 * extras and the total.
 */
export function installmentRows(bundle: LoanBundle): InstallmentRow[] {
  const fields = installmentFields(bundle);
  const enabled = fields.filter((field) => field.enabled);
  const entered = new Map(bundle.installments.map((item) => [item.number, item]));
  const last = bundle.installments.at(-1);
  const rows = bundle.schedule.schedule;
  return rows.map((row, index) => {
    const actual = entered.get(row.number);
    const amounts = Object.fromEntries(
      fields.map((field) => {
        if (actual) return [field.key, amountIn(actual, field)];
        if (row.source === 'actual') return [field.key, '0'];
        if (defaultApplies(field, row.dueDate)) return [field.key, field.defaultAmount ?? '0'];
        return [field.key, last ? amountIn(last, field) : '0'];
      }),
    );
    const extras = sum(enabled.map((field) => amounts[field.key] ?? '0'));
    return {
      number: row.number,
      dueDate: row.dueDate,
      capital: row.capital,
      interest: row.interest,
      amounts,
      extras: toPlain(extras),
      total: toPlain(dec(row.payment).plus(extras)),
      remaining: rows.length - index - 1,
      status: row.source === 'actual' ? 'paid' : 'projected',
    };
  });
}

export interface InstallmentSummary {
  paid: number;
  projected: number;
  capital: string;
  interest: string;
  /** Sum of each field over the rows, enabled or not (only enabled ones are in `extras`). */
  fields: Record<string, string>;
  extras: string;
  total: string;
}

/** What the rows on screen add up to (the period summary follows the filter). */
export function summarizeInstallments(rows: readonly InstallmentRow[]): InstallmentSummary {
  const keys = new Set(rows.flatMap((row) => Object.keys(row.amounts)));
  return {
    paid: rows.filter((row) => row.status === 'paid').length,
    projected: rows.filter((row) => row.status === 'projected').length,
    capital: toPlain(sum(rows.map((row) => row.capital))),
    interest: toPlain(sum(rows.map((row) => row.interest))),
    fields: Object.fromEntries(
      [...keys].map((key) => [key, toPlain(sum(rows.map((row) => row.amounts[key] ?? '0')))]),
    ),
    extras: toPlain(sum(rows.map((row) => row.extras))),
    total: toPlain(sum(rows.map((row) => row.total))),
  };
}

/**
 * The enabled fields to show as columns. With `hideEmpty`, a field with no value in the given
 * rows is left out (the data is untouched; the column comes back when the period has a value).
 */
export function visibleFields(
  fields: readonly InstallmentField[],
  rows: readonly InstallmentRow[],
  hideEmpty: boolean,
): InstallmentField[] {
  return fields.filter(
    (field) =>
      field.enabled && (!hideEmpty || rows.some((row) => hasAmount(row.amounts[field.key]))),
  );
}

/** `Seguro de proteção` → `seguroDeProtecao`: a unique field key from a name (letters and digits). */
export function fieldKeyFor(name: string, taken: readonly string[]): string {
  const words = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  const camel = words
    .map((word, index) =>
      index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join('');
  const base = (/^[a-zA-Z]/.test(camel) ? camel : `f${camel}`).slice(0, 36) || 'field';
  let key = base;
  for (let n = 2; taken.includes(key) || RESERVED_LOAN_FIELD_KEYS.includes(key); n += 1)
    key = `${base}${n}`;
  return key;
}

/** Text a spreadsheet would run as a formula gets a leading quote (user labels go in the header). */
const csvText = (value: string): string => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);

const csvCell = (value: string): string =>
  /[";\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/** The table as CSV (semicolons, decimal point): the fixed columns plus every enabled field. */
export function installmentsCsv(
  rows: readonly InstallmentRow[],
  fields: readonly InstallmentField[],
  head: { number: string; date: string; capital: string; interest: string; total: string },
): string {
  const enabled = fields.filter((field) => field.enabled);
  const lines = [
    [
      head.number,
      head.date,
      head.capital,
      head.interest,
      ...enabled.map((f) => f.label),
      head.total,
    ].map(csvText),
    ...rows.map((row) => [
      String(row.number),
      row.dueDate,
      row.capital,
      row.interest,
      ...enabled.map((field) => row.amounts[field.key] ?? '0'),
      row.total,
    ]),
  ];
  return lines.map((line) => line.map(csvCell).join(';')).join('\n');
}
