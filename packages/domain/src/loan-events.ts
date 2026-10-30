import { addMonths } from './dates';
import { dec, roundCents, toPlain, type Dec, type DecInput } from './decimal';
import { frenchPayment, type InstallmentAmounts } from './loans';

/**
 * Loan events (PRD "Real estate and loans"): prepayments, rate reviews and renegotiations. Each one
 * changes the rate, the balance, the installment or the term from `effectiveFrom` on: the first
 * installment due on or after that date is the first one that feels it. Pure: decimal strings in
 * and out, rounded to cents where a bank would.
 */

export const PREPAYMENT_EFFECTS = ['reduce_installment', 'reduce_term'] as const;
export type PrepaymentEffect = (typeof PREPAYMENT_EFFECTS)[number];

export type LoanEvent =
  | {
      kind: 'prepayment';
      effectiveFrom: string;
      /** Capital paid off early. The fee is a cost, not capital, so it is not part of the event here. */
      amount: DecInput;
      effect: PrepaymentEffect;
    }
  | {
      kind: 'rate_review';
      effectiveFrom: string;
      /** New nominal annual rate in percent. */
      annualPct: DecInput;
      /** The installment the bank announced; recomputed when left out. */
      newInstallment?: DecInput | null;
    }
  | {
      kind: 'renegotiation';
      effectiveFrom: string;
      annualPct?: DecInput | null;
      /** Installments left counted from `effectiveFrom`. */
      termMonths?: number | null;
      newInstallment?: DecInput | null;
    };

export interface EventScheduleRow {
  number: number;
  dueDate: string;
  capital: string;
  interest: string;
  payment: string;
  balanceAfter: string;
  /** Nominal annual rate in force for this row. */
  annualPct: string;
}

/** What one event did to the installment and to the term when it took effect. */
export interface EventImpact {
  /** Index in the (sorted) list of events the engine was given. */
  event: number;
  /** First installment that feels it. */
  number: number;
  balanceBefore: string;
  paymentBefore: string;
  paymentAfter: string;
  remainingBefore: number;
  remainingAfter: number;
  annualPctBefore: string;
  annualPctAfter: string;
}

export interface EventScheduleInput {
  balance: DecInput;
  annualPct: DecInput;
  /** Installments left to pay. */
  months: number;
  firstDueDate: string;
  firstNumber?: number;
  events?: readonly LoanEvent[];
}

const MAX_ROWS = 1200;
const monthly = (annualPct: DecInput): Dec => dec(annualPct).div(1200);
const notBelowZero = (value: Dec): Dec => (value.lt(0) ? dec(0) : value);

/**
 * How many installments of `payment` pay `balance` off at `annualPct`. The last one may be smaller.
 * Throws when the payment does not even cover the interest.
 */
export function monthsToPayOff(balance: DecInput, annualPct: DecInput, payment: DecInput): number {
  let owed = dec(balance);
  const rate = monthly(annualPct);
  const fixed = dec(payment);
  let months = 0;
  while (owed.gt(0)) {
    const interest = roundCents(owed.times(rate));
    const capital = fixed.minus(interest);
    if (capital.lte(0)) throw new RangeError('the installment does not cover the interest');
    owed = owed.minus(capital);
    months += 1;
    if (months > MAX_ROWS) throw new RangeError('the loan would last more than 100 years');
  }
  return months;
}

/**
 * The schedule from a balance, applying the events as their dates come. Rows stop when the balance
 * reaches zero (a term-reducing prepayment ends the loan sooner); the last one takes what is left.
 */
export function buildEventSchedule(input: EventScheduleInput): {
  rows: EventScheduleRow[];
  impacts: EventImpact[];
} {
  const events = [...(input.events ?? [])]
    .map((event, index) => ({ event, index }))
    .sort(
      (a, b) => a.event.effectiveFrom.localeCompare(b.event.effectiveFrom) || a.index - b.index,
    );
  const firstNumber = input.firstNumber ?? 1;
  let balance = dec(input.balance);
  let rate = dec(input.annualPct);
  let remaining = input.months;
  let payment = dec(frenchPayment(balance, rate, remaining));
  const rows: EventScheduleRow[] = [];
  const impacts: EventImpact[] = [];
  let next = 0;

  for (let index = 0; balance.gt(0) && index < MAX_ROWS; index += 1) {
    const number = firstNumber + index;
    const dueDate = addMonths(input.firstDueDate, index);

    for (
      let item = events[next];
      item && item.event.effectiveFrom <= dueDate;
      item = events[next]
    ) {
      const { event } = item;
      const before = { balance, payment, remaining, rate };
      if (event.kind === 'prepayment') {
        balance = notBelowZero(balance.minus(event.amount));
        if (balance.gt(0)) {
          if (event.effect === 'reduce_installment') {
            payment = dec(frenchPayment(balance, rate, remaining));
          } else {
            remaining = monthsToPayOff(balance, rate, payment);
          }
        }
      } else {
        if (event.annualPct !== undefined && event.annualPct !== null) rate = dec(event.annualPct);
        if (event.kind === 'renegotiation' && event.termMonths) remaining = event.termMonths;
        payment = event.newInstallment
          ? dec(event.newInstallment)
          : dec(frenchPayment(balance, rate, remaining));
        // A fixed installment decides how long the loan lasts.
        if (event.newInstallment && balance.gt(0)) {
          remaining = monthsToPayOff(balance, rate, payment);
        }
      }
      impacts.push({
        event: item.index,
        number,
        balanceBefore: toPlain(before.balance),
        paymentBefore: toPlain(before.payment),
        paymentAfter: toPlain(payment),
        remainingBefore: before.remaining,
        remainingAfter: remaining,
        annualPctBefore: toPlain(before.rate),
        annualPctAfter: toPlain(rate),
      });
      next += 1;
    }
    if (balance.lte(0)) break;

    const interest = roundCents(balance.times(monthly(rate)));
    const room = payment.minus(interest);
    if (room.lt(0)) throw new RangeError('the installment does not cover the interest');
    const last = remaining <= 1 || room.gte(balance);
    const capital = last ? balance : room;
    balance = balance.minus(capital);
    remaining -= 1;
    rows.push({
      number,
      dueDate,
      capital: toPlain(capital),
      interest: toPlain(interest),
      payment: toPlain(capital.plus(interest)),
      balanceAfter: toPlain(balance),
      annualPct: toPlain(rate),
    });
  }
  return { rows, impacts };
}

export interface ProjectedRow extends EventScheduleRow {
  source: 'actual' | 'projected';
}

export interface ProjectLoanInput {
  principal: DecInput;
  annualPct: DecInput;
  termMonths: number;
  firstDueDate: string;
  events: readonly LoanEvent[];
  /** Installments the bank charged, whatever their number. */
  actual: readonly InstallmentAmounts[];
}

/**
 * The whole plan: the installments paid, then the rest projected from the balance they left. The
 * rate and the installments left come from replaying the events from the first installment, so a
 * review recorded in the past carries on into the projection. Events dated after the last
 * installment paid are applied inside the projection.
 */
export function projectLoan(input: ProjectLoanInput): {
  rows: ProjectedRow[];
  impacts: EventImpact[];
  /** Capital still owed after the installments paid and the prepayments in effect. */
  outstanding: string;
} {
  const replay = buildEventSchedule({
    balance: input.principal,
    annualPct: input.annualPct,
    months: input.termMonths,
    firstDueDate: input.firstDueDate,
    events: input.events,
  });
  const actual = [...input.actual].sort((a, b) => a.number - b.number);
  const lastActual = actual.at(-1);
  if (!lastActual) {
    return {
      rows: replay.rows.map((row) => ({ ...row, source: 'projected' as const })),
      impacts: replay.impacts,
      outstanding: toPlain(dec(input.principal)),
    };
  }

  const inEffect = input.events.filter((event) => event.effectiveFrom <= lastActual.dueDate);
  const upcoming = input.events.filter((event) => event.effectiveFrom > lastActual.dueDate);
  const prepaid = inEffect.reduce(
    (total, event) => (event.kind === 'prepayment' ? total.plus(event.amount) : total),
    dec(0),
  );
  let paid = dec(0);
  const rows: ProjectedRow[] = actual.map((row) => {
    paid = paid.plus(row.capital);
    const prepaidByThen = input.events.reduce(
      (total, event) =>
        event.kind === 'prepayment' && event.effectiveFrom <= row.dueDate
          ? total.plus(event.amount)
          : total,
      dec(0),
    );
    const replayed = replay.rows.find((candidate) => candidate.number === row.number);
    return {
      number: row.number,
      dueDate: row.dueDate,
      capital: toPlain(row.capital),
      interest: toPlain(row.interest),
      payment: toPlain(dec(row.capital).plus(row.interest)),
      balanceAfter: toPlain(notBelowZero(dec(input.principal).minus(paid).minus(prepaidByThen))),
      annualPct: replayed?.annualPct ?? toPlain(dec(input.annualPct)),
      source: 'actual' as const,
    };
  });

  const balance = notBelowZero(dec(input.principal).minus(paid).minus(prepaid));
  // The state the projection starts from comes from the events already in force: the ones still to
  // come are applied inside the projection, so they must not shape its starting rate or term too.
  const inForce = buildEventSchedule({
    balance: input.principal,
    annualPct: input.annualPct,
    months: input.termMonths,
    firstDueDate: input.firstDueDate,
    events: inEffect,
  }).rows;
  const rate =
    inForce.find((row) => row.number === lastActual.number)?.annualPct ??
    toPlain(dec(input.annualPct));
  // Installments left: what that plan says, or what the term leaves when it ended early.
  const left = Math.max(
    1,
    inForce.length > lastActual.number
      ? inForce.length - lastActual.number
      : input.termMonths - lastActual.number,
  );
  const projection = balance.gt(0)
    ? buildEventSchedule({
        balance,
        annualPct: rate,
        months: left,
        firstDueDate: addMonths(input.firstDueDate, lastActual.number),
        firstNumber: lastActual.number + 1,
        events: upcoming,
      })
    : { rows: [], impacts: [] };
  return {
    rows: [...rows, ...projection.rows.map((row) => ({ ...row, source: 'projected' as const }))],
    impacts: replay.impacts,
    outstanding: toPlain(balance),
  };
}

/** Euribor of the review plus the spread, never below zero. */
export function reviewedRate(indexPct: DecInput, spreadPct: DecInput): string {
  return toPlain(notBelowZero(dec(indexPct).plus(spreadPct)));
}

/** The installment a review would set: today's balance over the installments left at the new rate. */
export function reviewPreview(
  balance: DecInput,
  newAnnualPct: DecInput,
  remainingMonths: number,
): string {
  return frenchPayment(balance, newAnnualPct, remainingMonths);
}

/**
 * From when an event is felt when the borrower does not say. A prepayment made during a month shows
 * from the installment of the next month (the reference loan: 01/02/2023 → 03/2023); a review or a
 * renegotiation from its own date.
 */
export function defaultEffectiveFrom(kind: LoanEvent['kind'], date: string): string {
  if (kind !== 'prepayment') return date;
  return addMonths(`${date.slice(0, 7)}-01`, 1);
}

/** The first review date after `today`: the anchor plus whole review periods. */
export function nextReviewDate(
  anchor: string,
  reviewMonths: number | null,
  today: string,
): string | null {
  if (!reviewMonths || reviewMonths < 1) return null;
  let date = anchor;
  for (let step = 1; date <= today && step <= 1200; step += 1) {
    date = addMonths(anchor, step * reviewMonths);
  }
  return date;
}
