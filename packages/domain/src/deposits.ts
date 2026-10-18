import { addDays, addMonths, daysBetween } from './dates';
import { dec, roundCents, sum, type Dec, type DecInput, type Money } from './decimal';

export type PeriodUnit = 'm' | 'd';

/** A term deposit (an account of type "prazo"). Rates and taxes are percentages. */
export interface Deposit {
  id: string;
  capital: DecInput;
  /** Annual rate (TANB), in percent. */
  rate: DecInput;
  start: string | null;
  /** Interest is paid every `payN` `payU`; without it the deposit has no schedule. */
  payN?: number | null;
  payU?: PeriodUnit | null;
  /** Term: `termN` `termU`, or the older `termMonths`; none means open-ended. */
  termN?: number | null;
  termU?: PeriodUnit | null;
  termMonths?: number | null;
  /** Unscheduled deposits only: compound the interest instead of simple interest. */
  capitalize?: boolean;
  /** Tax on interest in percent; missing means the pool's default. */
  tax?: DecInput | null;
  /** Account that receives the interest; without it the interest capitalizes in the deposit. */
  payTo?: string | null;
  /** Account that funds the deposit and, at maturity, gets the money back. */
  fundFrom?: string | null;
}

export interface DepositPeriod {
  /** 1-based period number. */
  k: number;
  date: string;
  days: number;
  base: Money;
  gross: Money;
  net: Money;
}

export interface DepositValue {
  capital: Money;
  /** Gross and net interest up to the date. */
  gross: Money;
  net: Money;
  /** Capital plus capitalized interest still held by the deposit (0 once returned). */
  value: Money;
  /** Interest paid out so far (scheduled deposits). */
  paid: Money;
  /** Interest accrued since the last payment (scheduled deposits). */
  accrued: Money;
  maturity: string | null;
  /** Next payment after the date (scheduled deposits). */
  next: DepositPeriod | null;
  matured: boolean;
  returned: boolean;
}

const MAX_PERIODS = 1000;
const HORIZON_MONTHS = 24;
const ZERO = dec(0);

export const isScheduled = (deposit: Deposit): boolean => Number(deposit.payN) > 0;

function addPeriod(date: string, n: number, unit: PeriodUnit | null | undefined): string {
  return unit === 'd' ? addDays(date, n) : addMonths(date, n);
}

/** Share of the interest kept after tax: the deposit's own tax, otherwise the default (percent). */
function keepFactor(deposit: Deposit, defaultTax: DecInput): Dec {
  const own = deposit.tax;
  const percent = own != null && own !== '' && dec(own).isFinite() ? dec(own) : dec(defaultTax);
  return dec(1).minus(percent.div(100));
}

const annualRate = (deposit: Deposit): Dec => dec(deposit.rate).div(100);

export function depositMaturity(deposit: Deposit): string | null {
  if (!deposit.start) return null;
  const legacy = deposit.termN == null;
  const n = legacy ? deposit.termMonths : deposit.termN;
  return n ? addPeriod(deposit.start, n, legacy ? 'm' : deposit.termU) : null;
}

/** Where the capital goes back at maturity. */
export const depositReturnTo = (deposit: Deposit): string =>
  deposit.fundFrom || deposit.payTo || '';

/**
 * Interest payments of a scheduled deposit: every `payN` units from the start (each date counted
 * from the start, so 31 Jan + 1 month = 28/29 Feb and then 31 Mar), clamped to the maturity.
 * Without maturity it stops 24 months after `asOf`. Gross = base × rate × days / 365 and net after
 * tax, both rounded to cents; the net joins the base when no `payTo` account receives it.
 */
export function depositSchedule(
  deposit: Deposit,
  asOf: string,
  defaultTax: DecInput,
): DepositPeriod[] {
  const { start } = deposit;
  if (!isScheduled(deposit) || !start) return [];
  const rate = annualRate(deposit);
  const keep = keepFactor(deposit, defaultTax);
  const maturity = depositMaturity(deposit);
  const horizon = maturity ?? addMonths(asOf, HORIZON_MONTHS);
  const periods: DepositPeriod[] = [];
  let base = dec(deposit.capital);
  let previous = start;
  for (let k = 1; k < MAX_PERIODS; k++) {
    const due = addPeriod(start, k * Number(deposit.payN), deposit.payU);
    const last = !!maturity && due >= maturity;
    const date = last ? maturity : due;
    if (date > horizon) break;
    const days = daysBetween(previous, date);
    const gross = roundCents(base.times(rate).times(days).div(365));
    const net = roundCents(gross.times(keep));
    periods.push({ k, date, days, base, gross, net });
    if (!deposit.payTo) base = base.plus(net);
    previous = date;
    if (last) break;
  }
  return periods;
}

const EMPTY_VALUE: DepositValue = {
  capital: ZERO,
  gross: ZERO,
  net: ZERO,
  value: ZERO,
  paid: ZERO,
  accrued: ZERO,
  maturity: null,
  next: null,
  matured: false,
  returned: false,
};

/** Interest that stays in the deposit: all of it, unless a pay-to account receives it. */
const capitalizedInterest = (deposit: Deposit, periods: readonly DepositPeriod[]): Money =>
  deposit.payTo ? ZERO : sum(periods.map((p) => p.net));

/** Capital plus interest up to `asOf`; a deposit that has not started is worth 0. */
export function depositValue(deposit: Deposit, asOf: string, defaultTax: DecInput): DepositValue {
  const { start } = deposit;
  if (!start || asOf < start) return { ...EMPTY_VALUE };
  const capital = dec(deposit.capital);
  const rate = annualRate(deposit);
  const keep = keepFactor(deposit, defaultTax);
  const maturity = depositMaturity(deposit);

  if (!isScheduled(deposit)) {
    const end = maturity && asOf > maturity ? maturity : asOf;
    const years = dec(daysBetween(start, end)).div(365);
    const gross = deposit.capitalize
      ? capital.times(dec(1).plus(rate).pow(years).minus(1))
      : capital.times(rate).times(years);
    const net = gross.times(keep);
    return { ...EMPTY_VALUE, capital, gross, net, value: capital.plus(net), maturity };
  }

  const all = depositSchedule(deposit, asOf, defaultTax);
  const paidPeriods = all.filter((p) => p.date <= asOf);
  const paid = sum(paidPeriods.map((p) => p.net));
  const kept = capitalizedInterest(deposit, paidPeriods);
  const matured = !!maturity && asOf >= maturity;
  const returned = matured && !!depositReturnTo(deposit);
  const lastDate = paidPeriods[paidPeriods.length - 1]?.date ?? start;
  const accrued = matured
    ? ZERO
    : capital.plus(kept).times(rate).times(daysBetween(lastDate, asOf)).div(365).times(keep);
  return {
    capital,
    gross: sum(paidPeriods.map((p) => p.gross)),
    net: returned ? ZERO : kept,
    value: returned ? ZERO : capital.plus(kept),
    paid,
    accrued,
    maturity,
    next: all.find((p) => p.date > asOf) ?? null,
    matured,
    returned,
  };
}

export type DepositFlowKind = 'capital' | 'interest' | 'redemption';

/** A movement the deposit is expected to cause in a current account. */
export interface DepositFlow {
  accountId: string;
  depositId: string;
  kind: DepositFlowKind;
  date: string;
  /** Account currency; negative leaves the account. */
  amount: Money;
}

/** Stable identity of a flow, stored on the statement line it was linked to. */
export function depositFlowKey(flow: Pick<DepositFlow, 'depositId' | 'date' | 'kind'>): string {
  return `${flow.depositId}:${flow.date}:${flow.kind}`;
}

/**
 * Movements the scheduled deposits cause in one account: the capital leaving the funding account,
 * each net interest entering the pay-to account, and the capital (plus capitalized interest) back
 * at maturity in the return account.
 */
export function depositFlows(
  accountId: string,
  deposits: readonly Deposit[],
  asOf: string,
  defaultTax: DecInput,
): DepositFlow[] {
  const flows: DepositFlow[] = [];
  for (const deposit of deposits) {
    if (!isScheduled(deposit) || !deposit.start) continue;
    const base = { accountId, depositId: deposit.id };
    const capital = dec(deposit.capital);
    const maturity = depositMaturity(deposit);
    const receivesInterest = !!deposit.payTo && deposit.payTo === accountId;
    const getsRedemption = !!maturity && depositReturnTo(deposit) === accountId;
    const schedule =
      receivesInterest || getsRedemption ? depositSchedule(deposit, asOf, defaultTax) : [];
    if (deposit.fundFrom === accountId) {
      flows.push({ ...base, kind: 'capital', date: deposit.start, amount: capital.neg() });
    }
    if (receivesInterest) {
      for (const p of schedule)
        flows.push({ ...base, kind: 'interest', date: p.date, amount: p.net });
    }
    if (getsRedemption) {
      const amount = capital.plus(capitalizedInterest(deposit, schedule));
      flows.push({ ...base, kind: 'redemption', date: maturity, amount });
    }
  }
  return flows;
}

/** The part of a statement line the linking needs. */
export interface LinkableTransaction {
  id: string;
  accountId: string;
  date: string;
  amount: DecInput;
  /** Key of the flow it is already linked to. */
  depositLink?: string | null;
  /** Category fixed by the user: keep it, but still record the link. */
  transferLocked?: boolean;
}

export interface DepositLinkDecision {
  transactionId: string;
  depositId: string;
  flowKey: string;
  kind: DepositFlowKind;
  /** Capital and redemption become an internal transfer (unless locked); interest does not. */
  markAsTransfer: boolean;
  /** Interest is marked as that deposit's interest. */
  markAsDepositInterest: boolean;
}

const CAPITAL_TOLERANCE = dec('0.011');
const INTEREST_MIN_TOLERANCE = dec('0.05');
const INTEREST_TOLERANCE_RATE = dec('0.02');
const LINK_WINDOW_DAYS = 5;

function interestTolerance(amount: Money): Dec {
  const relative = amount.abs().times(INTEREST_TOLERANCE_RATE);
  return relative.gt(INTEREST_MIN_TOLERANCE) ? relative : INTEREST_MIN_TOLERANCE;
}

/**
 * Matches statement lines to the expected deposit flows (same account and sign, amount within
 * 0.011 for capital or max(0.05, 2 %) for interest, date within ±5 days) and returns what to
 * record. Pure and idempotent: lines and flows that are already linked are skipped, and a line
 * links to at most one flow.
 */
export function linkDepositFlows(
  transactions: readonly LinkableTransaction[],
  flows: readonly DepositFlow[],
): DepositLinkDecision[] {
  const linkedKeys = new Set<string>();
  for (const tx of transactions) if (tx.depositLink) linkedKeys.add(tx.depositLink);
  const open = transactions
    .filter((tx) => !tx.depositLink)
    .map((tx) => ({ tx, amount: dec(tx.amount) }));
  const taken = new Set<string>();
  const decisions: DepositLinkDecision[] = [];

  for (const flow of flows) {
    const key = depositFlowKey(flow);
    if (linkedKeys.has(key)) continue;
    const tolerance = flow.kind === 'interest' ? interestTolerance(flow.amount) : CAPITAL_TOLERANCE;
    const match = open.find(
      ({ tx, amount }) =>
        tx.accountId === flow.accountId &&
        !taken.has(tx.id) &&
        amount.isNeg() === flow.amount.isNeg() &&
        amount.minus(flow.amount).abs().lte(tolerance) &&
        Math.abs(daysBetween(tx.date, flow.date)) <= LINK_WINDOW_DAYS,
    )?.tx;
    if (!match) continue;
    taken.add(match.id);
    decisions.push({
      transactionId: match.id,
      depositId: flow.depositId,
      flowKey: key,
      kind: flow.kind,
      markAsTransfer: flow.kind !== 'interest' && !match.transferLocked,
      markAsDepositInterest: flow.kind === 'interest',
    });
  }
  return decisions;
}
