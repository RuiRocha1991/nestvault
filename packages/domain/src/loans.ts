import { addMonths, daysBetween } from './dates';
import { dec, roundCents, sum, toPlain, type Dec, type DecInput } from './decimal';

/**
 * Loans (PRD "Real estate and loans"): the French amortization schedule and everything the loan
 * screens add up from the installments. Pure: money in and out as decimal strings, rounded to
 * cents at the point an installment is generated, never JS floats.
 */

/** Optional components every loan can enable; `capital` and `interest` are always present. */
export const BUILTIN_LOAN_FIELDS = [
  'lifeInsurance',
  'homeInsurance',
  'creditInsurance',
  'fees',
  'stampTax',
] as const;
export type BuiltinLoanField = (typeof BUILTIN_LOAN_FIELDS)[number];

/** Names of the installment's own properties: a custom field cannot take them as its key. */
export const RESERVED_LOAN_FIELD_KEYS: readonly string[] = [
  'id',
  'number',
  'dueDate',
  'capital',
  'interest',
  'total',
  'status',
  'source',
  'custom',
  'loanId',
  'amounts',
  'extras',
];

/** On when a loan is created; the others are enabled by hand or by an import that has values. */
export const DEFAULT_ENABLED_LOAN_FIELDS: readonly BuiltinLoanField[] = [
  'lifeInsurance',
  'homeInsurance',
];

/** A field of a loan as the totals see it. A disabled field keeps its values but adds up to nothing. */
export interface LoanFieldSetting {
  key: string;
  enabled: boolean;
  /** Counts as an expense (not savings) when a bank debit is linked to the installment. */
  countsAsExpense: boolean;
}

/** One installment, actual or projected. `amounts` holds the optional fields by key. */
export interface InstallmentAmounts {
  number: number;
  dueDate: string;
  capital: DecInput;
  interest: DecInput;
  amounts?: Readonly<Record<string, DecInput>>;
}

const monthlyRate = (annualPct: DecInput): Dec => dec(annualPct).div(1200);

/**
 * The fixed installment (capital + interest) of a French loan: `P·r / (1 − (1 + r)^−n)` with `r`
 * the monthly rate; at a zero rate the balance is split evenly. Rounded to cents.
 */
export function frenchPayment(balance: DecInput, annualPct: DecInput, months: number): string {
  if (!Number.isInteger(months) || months < 1) throw new RangeError('months must be at least 1');
  const rate = monthlyRate(annualPct);
  if (rate.isZero()) return toPlain(roundCents(dec(balance).div(months)));
  const factor = rate.plus(1).pow(-months);
  return toPlain(roundCents(dec(balance).times(rate).div(dec(1).minus(factor))));
}

export interface ScheduleRow {
  number: number;
  dueDate: string;
  capital: string;
  interest: string;
  /** Capital + interest (the optional fields are not part of a projection). */
  payment: string;
  /** What is still owed after this installment. */
  balanceAfter: string;
}

export interface ScheduleInput {
  /** Outstanding capital before the first row. */
  balance: DecInput;
  /** Nominal annual rate in percent. */
  annualPct: DecInput;
  /** Installments left to pay. */
  months: number;
  /** Due date of the first row; the next ones fall every month after it. */
  firstDueDate: string;
  /** Number of the first row (1 for a new loan; the next number after the last paid one otherwise). */
  firstNumber?: number;
}

/**
 * The projected schedule from an outstanding balance, a rate and the installments left. Interest of
 * each row is the balance times the monthly rate, in cents; the last row takes whatever capital is
 * left, so the capital of the schedule always adds up to the balance and the balance ends at 0.
 */
export function buildSchedule(input: ScheduleInput): ScheduleRow[] {
  const { annualPct, months, firstDueDate } = input;
  const firstNumber = input.firstNumber ?? 1;
  const payment = dec(frenchPayment(input.balance, annualPct, months));
  const rate = monthlyRate(annualPct);
  const rows: ScheduleRow[] = [];
  let balance = dec(input.balance);
  for (let index = 0; index < months; index += 1) {
    const interest = roundCents(balance.times(rate));
    const last = index === months - 1;
    const capital = last ? balance : payment.minus(interest);
    balance = balance.minus(capital);
    rows.push({
      number: firstNumber + index,
      dueDate: addMonths(firstDueDate, index),
      capital: toPlain(capital),
      interest: toPlain(interest),
      payment: toPlain(capital.plus(interest)),
      balanceAfter: toPlain(balance),
    });
  }
  return rows;
}

/** What is still owed: the principal minus the capital paid in installments and in prepayments. */
export function outstandingBalance(
  principal: DecInput,
  capitalPaid: DecInput,
  prepayments: DecInput = 0,
): string {
  return toPlain(dec(principal).minus(capitalPaid).minus(prepayments));
}

/** Installments left in the term after the paid ones. */
export function remainingInstallments(termMonths: number, paidCount: number): number {
  return Math.max(0, termMonths - paidCount);
}

/** The year of the contract an installment belongs to: installments 1–12 are year 1. */
export function contractYear(number: number): number {
  return Math.floor((number - 1) / 12) + 1;
}

const enabledKeys = (fields: readonly LoanFieldSetting[]) =>
  new Set(fields.filter((field) => field.enabled).map((field) => field.key));

const amountOf = (row: InstallmentAmounts, key: string): Dec => dec(row.amounts?.[key] ?? 0);

/** Capital + interest + every enabled field. A disabled field is kept in the data but not counted. */
export function installmentTotal(
  row: InstallmentAmounts,
  fields: readonly LoanFieldSetting[],
): string {
  const keys = enabledKeys(fields);
  const extras = [...keys].map((key) => amountOf(row, key));
  return toPlain(sum([row.capital, row.interest, ...extras]));
}

export interface InstallmentTotals {
  count: number;
  capital: string;
  interest: string;
  /** Sum of each enabled optional field. */
  fields: Record<string, string>;
  /** Capital + interest + enabled fields: what left the account. */
  total: string;
  /** Everything but the capital: interest plus the enabled fields. */
  costOfCredit: string;
}

/** Adds up installments by component. Only enabled fields count, in the total and in the cost of credit. */
export function totalsOf(
  rows: readonly InstallmentAmounts[],
  fields: readonly LoanFieldSetting[],
): InstallmentTotals {
  const keys = [...enabledKeys(fields)];
  const capital = sum(rows.map((row) => row.capital));
  const interest = sum(rows.map((row) => row.interest));
  const byField = Object.fromEntries(
    keys.map((key) => [key, sum(rows.map((row) => amountOf(row, key)))]),
  );
  const extras = sum(Object.values(byField));
  return {
    count: rows.length,
    capital: toPlain(capital),
    interest: toPlain(interest),
    fields: Object.fromEntries(
      Object.entries(byField).map(([key, value]) => [key, toPlain(value)]),
    ),
    total: toPlain(capital.plus(interest).plus(extras)),
    costOfCredit: toPlain(interest.plus(extras)),
  };
}

export interface YearTotals extends InstallmentTotals {
  year: number;
}

/** Totals per contract year (the spreadsheet's "Pago por anos"), oldest first. */
export function totalsByContractYear(
  rows: readonly InstallmentAmounts[],
  fields: readonly LoanFieldSetting[],
): YearTotals[] {
  const groups = new Map<number, InstallmentAmounts[]>();
  for (const row of rows) {
    const year = contractYear(row.number);
    groups.set(year, [...(groups.get(year) ?? []), row]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, group]) => ({ year, ...totalsOf(group, fields) }));
}

/** Totals of the installments due from `from` to `to`, both included (the period summary). */
export function periodTotals(
  rows: readonly InstallmentAmounts[],
  fields: readonly LoanFieldSetting[],
  from: string,
  to: string,
): InstallmentTotals {
  return totalsOf(
    rows.filter((row) => row.dueDate >= from && row.dueDate <= to),
    fields,
  );
}

export interface ExpenseSplit {
  /** Interest plus the enabled fields that count as an expense. */
  expense: string;
  /** The capital: savings / equity, not an expense. */
  savings: string;
  /** Enabled fields that do not count as an expense (a custom field marked as such). */
  other: string;
}

/**
 * How a bank debit linked to an installment is split: interest, fees, taxes and insurances are
 * expenses, the capital goes to savings (PRD, "Installment split").
 */
export function expenseSplit(
  row: InstallmentAmounts,
  fields: readonly LoanFieldSetting[],
): ExpenseSplit {
  const enabled = fields.filter((field) => field.enabled);
  const expenseFields = enabled.filter((field) => field.countsAsExpense);
  const otherFields = enabled.filter((field) => !field.countsAsExpense);
  return {
    expense: toPlain(
      sum([row.interest, ...expenseFields.map((field) => amountOf(row, field.key))]),
    ),
    savings: toPlain(dec(row.capital)),
    other: toPlain(sum(otherFields.map((field) => amountOf(row, field.key)))),
  };
}

export interface MergedInstallment extends ScheduleRow {
  source: 'actual' | 'projected';
}

/**
 * The full plan: every actual installment, then the projected rows with a number the actuals do not
 * have. An actual row replaces the projected one of the same number.
 */
export function mergeSchedule(
  actual: readonly (InstallmentAmounts & { balanceAfter?: DecInput })[],
  projected: readonly ScheduleRow[],
): MergedInstallment[] {
  const taken = new Set(actual.map((row) => row.number));
  const fromActual = actual.map<MergedInstallment>((row) => ({
    number: row.number,
    dueDate: row.dueDate,
    capital: toPlain(row.capital),
    interest: toPlain(row.interest),
    payment: toPlain(dec(row.capital).plus(row.interest)),
    balanceAfter: toPlain(row.balanceAfter ?? 0),
    source: 'actual',
  }));
  const fromProjection = projected
    .filter((row) => !taken.has(row.number))
    .map<MergedInstallment>((row) => ({ ...row, source: 'projected' }));
  return [...fromActual, ...fromProjection].sort((a, b) => a.number - b.number);
}

const INSURANCE_FIELDS: ReadonlySet<string> = new Set([
  'lifeInsurance',
  'homeInsurance',
  'creditInsurance',
]);

/** An installment as the expense rule reads it: where each part of a bank debit goes. */
export interface InstallmentCostSplit {
  /** Interest, fees, taxes and the other expense fields. */
  interest: string;
  /** Life, home and credit insurance (enabled ones that count as an expense). */
  insurance: string;
  /** The capital: savings / equity, not an expense. */
  capital: string;
}

/**
 * Splits an installment for the expense rule (PRD, "Installment split"): the interest and every
 * enabled expense field but the insurances go to `interest`, the insurances to `insurance`, the
 * capital stays apart. A disabled field, or one that does not count as an expense, adds to nothing.
 */
export function installmentCostSplit(
  row: InstallmentAmounts,
  fields: readonly LoanFieldSetting[],
): InstallmentCostSplit {
  const expense = fields.filter((field) => field.enabled && field.countsAsExpense);
  const insurances = expense.filter((field) => INSURANCE_FIELDS.has(field.key));
  const others = expense.filter((field) => !INSURANCE_FIELDS.has(field.key));
  return {
    interest: toPlain(sum([row.interest, ...others.map((field) => amountOf(row, field.key))])),
    insurance: toPlain(sum(insurances.map((field) => amountOf(row, field.key)))),
    capital: toPlain(dec(row.capital)),
  };
}

/** How far apart (days) an installment and its bank debit may be, and the amount tolerance (euros). */
export const MATCH_DAYS = 5;
export const MATCH_TOLERANCE = '0.05';

export interface InstallmentToMatch {
  id: string;
  dueDate: string;
  /** What the bank charges: capital + interest + enabled fields. */
  total: DecInput;
}

export interface DebitToMatch {
  id: string;
  date: string;
  /** Negative: it leaves the account. */
  amount: DecInput;
}

export interface InstallmentMatch {
  installmentId: string;
  transactionId: string;
}

/**
 * Pairs installments with the bank debits that paid them: the amount equals the installment total
 * to within a few cents and the date is within `MATCH_DAYS` of the due date. The closest date wins,
 * an earlier installment before a later one, and a debit is used once. The caller passes only the
 * debits of the loan's account that are not transfers and not linked yet.
 */
export function matchInstallments(
  installments: readonly InstallmentToMatch[],
  debits: readonly DebitToMatch[],
): InstallmentMatch[] {
  const taken = new Set<string>();
  const matches: InstallmentMatch[] = [];
  const ordered = [...installments].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  for (const installment of ordered) {
    let best: { debit: DebitToMatch; days: number } | undefined;
    for (const debit of debits) {
      if (taken.has(debit.id) || !dec(debit.amount).isNegative()) continue;
      const days = Math.abs(daysBetween(installment.dueDate, debit.date));
      if (days > MATCH_DAYS) continue;
      if (dec(debit.amount).abs().minus(installment.total).abs().gt(MATCH_TOLERANCE)) continue;
      if (!best || days < best.days) best = { debit, days };
    }
    if (best) {
      taken.add(best.debit.id);
      matches.push({ installmentId: installment.id, transactionId: best.debit.id });
    }
  }
  return matches;
}
