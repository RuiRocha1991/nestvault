import { daysBetween } from './dates';
import type { DecInput } from './decimal';
import { byDate } from './positions';

export interface CashFlow {
  /** ISO date `yyyy-mm-dd`. */
  date: string;
  /** Negative = money invested, positive = money received (or the current value). */
  amount: DecInput;
}

const MIN_RATE = -0.99;
const MAX_RATE = 10;
const MAX_ITERATIONS = 200;
const TOLERANCE = 1e-7;
const MIN_SPAN_DAYS = 30;

/**
 * Annualised internal rate of return of dated flows (spreadsheet XIRR: actual days / 365),
 * found by bisection on [-0.99, 10]. The result is a ratio, so it is computed in floats; the
 * flows themselves stay decimal until the last moment. Returns `NaN` when there are fewer than two
 * flows, no outflow or no inflow, a span under 30 days, or no sign change in the search range.
 */
export function xirr(flows: readonly CashFlow[]): number {
  const sorted = flows
    .map((flow) => ({ date: flow.date, amount: Number(flow.amount) }))
    .sort(byDate);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last || sorted.length < 2) return NaN;
  if (!sorted.some((f) => f.amount < 0) || !sorted.some((f) => f.amount > 0)) return NaN;
  if (daysBetween(first.date, last.date) < MIN_SPAN_DAYS) return NaN;

  const timed = sorted.map((f) => ({
    amount: f.amount,
    years: daysBetween(first.date, f.date) / 365,
  }));
  const npv = (rate: number) =>
    timed.reduce((total, f) => total + f.amount / Math.pow(1 + rate, f.years), 0);

  let lo = MIN_RATE;
  let hi = MAX_RATE;
  let npvLo = npv(lo);
  if (npvLo * npv(hi) > 0) return NaN;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    const npvMid = npv(mid);
    if (Math.abs(npvMid) < TOLERANCE) return mid;
    if (npvLo * npvMid < 0) {
      hi = mid;
    } else {
      lo = mid;
      npvLo = npvMid;
    }
  }
  return (lo + hi) / 2;
}
