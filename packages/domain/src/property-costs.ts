import { addMonths, monthKey } from './dates';
import { dec, roundCents, sum, toPlain, type DecInput } from './decimal';

/**
 * Recurring costs of a property (PRD "Real estate and loans"): the IMI, the condominium and the
 * insurances that are paid on their own. The occurrences of a cost come from its start date and its
 * interval; what is paid, still expected or already inside a loan installment is worked out here and
 * never stored. Pure: decimal strings in and out.
 */

export const PROPERTY_COST_KINDS = [
  'insurance_home',
  'insurance_life',
  'imi',
  'condominium',
  'other',
] as const;
export type PropertyCostKind = (typeof PROPERTY_COST_KINDS)[number];

export interface CostInput {
  id: string;
  propertyId: string;
  kind: PropertyCostKind;
  amount: DecInput;
  /** Months between two occurrences. */
  intervalMonths: number;
  startDate: string;
  endDate?: string | null;
}

/** The insurances a loan installment of the property carries, with the amounts of enabled fields only. */
export interface InstallmentInsurance {
  propertyId: string;
  dueDate: string;
  home: DecInput;
  life: DecInput;
  credit: DecInput;
}

/** `paid` was settled by a bank debit; `covered` is already inside an installment; `expected` is still to come. */
export type OccurrenceStatus = 'expected' | 'paid' | 'covered';

export interface CostOccurrence {
  costId: string;
  propertyId: string;
  kind: PropertyCostKind;
  dueDate: string;
  amount: string;
  status: OccurrenceStatus;
}

/** Years of occurrences one call can produce: a guard against a runaway range, not a business rule. */
const MAX_OCCURRENCES = 1200;

/** The key of a paid occurrence in the set `costOccurrences` takes. */
export const occurrenceKey = (costId: string, dueDate: string): string => `${costId}|${dueDate}`;

/** The due dates of a cost from `from` to `to`, both included. Anchored on the start date, so a 31st never drifts. */
export function dueDates(
  cost: Pick<CostInput, 'startDate' | 'endDate' | 'intervalMonths'>,
  from: string,
  to: string,
): string[] {
  const last = cost.endDate && cost.endDate < to ? cost.endDate : to;
  const dates: string[] = [];
  for (let index = 0; index < MAX_OCCURRENCES; index += 1) {
    const date = addMonths(cost.startDate, index * cost.intervalMonths);
    if (date > last) break;
    if (date >= from) dates.push(date);
  }
  return dates;
}

/** Whether `date` is one of the cost's due dates (it ignores the end of a range, not the cost's own end). */
export function isDueDate(
  cost: Pick<CostInput, 'startDate' | 'endDate' | 'intervalMonths'>,
  date: string,
): boolean {
  return dueDates(cost, date, date).length === 1;
}

/** What the cost adds up to in a year, in cents: an annual one as it is, a monthly one times 12. */
export function annualAmount(amount: DecInput, intervalMonths: number): string {
  if (!Number.isInteger(intervalMonths) || intervalMonths < 1) {
    throw new RangeError('intervalMonths must be at least 1');
  }
  return toPlain(roundCents(dec(amount).times(12).div(intervalMonths)));
}

/** The insurance an installment already carries for a cost kind; the other kinds are never inside one. */
function insidesInstallment(kind: PropertyCostKind, row: InstallmentInsurance): boolean {
  if (kind === 'insurance_home') return dec(row.home).gt(0);
  if (kind === 'insurance_life') return dec(row.life).gt(0);
  return false;
}

export interface OccurrenceOptions {
  /** Occurrences settled by a bank debit, as `occurrenceKey`s. */
  paid?: ReadonlySet<string>;
  /** Installments of the property's loans, to avoid counting an insurance twice. */
  installments?: readonly InstallmentInsurance[];
}

/**
 * Every occurrence of the costs from `from` to `to`, oldest first. An insurance whose month already
 * has the same insurance inside a loan installment of the property is `covered`: the installment
 * counts it, so the cost must not (no double counting). A paid occurrence stays `paid` even then,
 * because the bank debit is real.
 */
export function costOccurrences(
  costs: readonly CostInput[],
  from: string,
  to: string,
  options: OccurrenceOptions = {},
): CostOccurrence[] {
  const paid = options.paid ?? new Set<string>();
  const inside = new Set(
    (options.installments ?? []).flatMap((row) =>
      (['insurance_home', 'insurance_life'] as const)
        .filter((kind) => insidesInstallment(kind, row))
        .map((kind) => `${row.propertyId}|${kind}|${monthKey(row.dueDate)}`),
    ),
  );
  const rows = costs.flatMap((cost) =>
    dueDates(cost, from, to).map<CostOccurrence>((dueDate) => {
      const settled = paid.has(occurrenceKey(cost.id, dueDate));
      const covered = inside.has(`${cost.propertyId}|${cost.kind}|${monthKey(dueDate)}`);
      return {
        costId: cost.id,
        propertyId: cost.propertyId,
        kind: cost.kind,
        dueDate,
        amount: toPlain(dec(cost.amount)),
        status: settled ? 'paid' : covered ? 'covered' : 'expected',
      };
    }),
  );
  return rows.sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.costId.localeCompare(b.costId),
  );
}

export interface CostTotals {
  /** Paid and expected occurrences by kind; `covered` ones are not here. */
  byKind: Record<PropertyCostKind, string>;
  /** Paid plus expected, without the insurances inside installments. */
  costs: string;
  paid: string;
  expected: string;
  /** Insurances inside the loan installments of the period. */
  installmentInsurance: string;
  /** What the property cost to hold: the costs plus the installment insurances. */
  total: string;
}

/**
 * Adds up a period. The installment insurances come from the installments in `from`–`to` and the
 * occurrences from `occurrences`; an occurrence `covered` by an installment is left out, so a policy
 * moved from an annual payment into the installment is counted once.
 */
export function costTotals(
  occurrences: readonly CostOccurrence[],
  installments: readonly InstallmentInsurance[],
  from: string,
  to: string,
): CostTotals {
  const counted = occurrences.filter(
    (row) => row.status !== 'covered' && row.dueDate >= from && row.dueDate <= to,
  );
  const byKind = Object.fromEntries(
    PROPERTY_COST_KINDS.map((kind) => [
      kind,
      toPlain(sum(counted.filter((row) => row.kind === kind).map((row) => row.amount))),
    ]),
  ) as Record<PropertyCostKind, string>;
  const paid = sum(counted.filter((row) => row.status === 'paid').map((row) => row.amount));
  const expected = sum(counted.filter((row) => row.status === 'expected').map((row) => row.amount));
  const inInstallments = sum(
    installments
      .filter((row) => row.dueDate >= from && row.dueDate <= to)
      .flatMap((row) => [row.home, row.life, row.credit]),
  );
  return {
    byKind,
    costs: toPlain(paid.plus(expected)),
    paid: toPlain(paid),
    expected: toPlain(expected),
    installmentInsurance: toPlain(inInstallments),
    total: toPlain(paid.plus(expected).plus(inInstallments)),
  };
}

export interface CostMonth {
  /** `yyyy-mm`. */
  month: string;
  amount: string;
  occurrences: CostOccurrence[];
}

/** The occurrences still expected, by month, oldest first: what feeds the month forecast. */
export function expectedByMonth(occurrences: readonly CostOccurrence[]): CostMonth[] {
  const months = new Map<string, CostOccurrence[]>();
  for (const row of occurrences) {
    if (row.status !== 'expected') continue;
    const key = monthKey(row.dueDate);
    months.set(key, [...(months.get(key) ?? []), row]);
  }
  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, rows]) => ({
      month,
      amount: toPlain(sum(rows.map((row) => row.amount))),
      occurrences: rows,
    }));
}
