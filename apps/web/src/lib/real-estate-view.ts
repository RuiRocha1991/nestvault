import {
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

export interface InstallmentRow {
  number: number;
  dueDate: string;
  capital: string;
  interest: string;
  /** Insurances, fees and taxes: what the bank charges besides capital and interest. */
  extras: string;
  total: string;
  /** Installments left after this one. */
  remaining: number;
  status: 'paid' | 'projected';
}

/**
 * Every installment of a loan, entered ones first and the projection after them (mockup 29).
 * A projected row carries the extras of the last installment entered.
 */
export function installmentRows(bundle: LoanBundle): InstallmentRow[] {
  const entered = new Map(bundle.installments.map((item) => [item.number, item]));
  const last = bundle.installments.at(-1);
  const carried = last ? dec(last.total).minus(last.capital).minus(last.interest) : dec(0);
  const rows = bundle.schedule.schedule;
  return rows.map((row, index) => {
    const actual = entered.get(row.number);
    const extras = actual
      ? dec(actual.total).minus(actual.capital).minus(actual.interest)
      : row.source === 'actual'
        ? dec(0)
        : carried;
    return {
      number: row.number,
      dueDate: row.dueDate,
      capital: row.capital,
      interest: row.interest,
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
  extras: string;
  total: string;
}

/** What the rows on screen add up to (the period summary follows the filter). */
export function summarizeInstallments(rows: readonly InstallmentRow[]): InstallmentSummary {
  return {
    paid: rows.filter((row) => row.status === 'paid').length,
    projected: rows.filter((row) => row.status === 'projected').length,
    capital: toPlain(sum(rows.map((row) => row.capital))),
    interest: toPlain(sum(rows.map((row) => row.interest))),
    extras: toPlain(sum(rows.map((row) => row.extras))),
    total: toPlain(sum(rows.map((row) => row.total))),
  };
}
