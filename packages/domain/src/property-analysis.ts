import { dec, roundCents, sum, toPlain, type DecInput } from './decimal';
import { buildEventSchedule, type LoanEvent, type PrepaymentEffect } from './loan-events';
import { frenchPayment } from './loans';

/**
 * What a property page shows beyond the schedule (PRD "Real estate and loans" → Venda e simulador):
 * where the money went, the sale analysis, the payoff simulator, the pace to a goal and the
 * inflation-adjusted price. Pure: decimal strings in and out.
 */

// --- Where the money went -------------------------------------------------------------------

export interface MoneySpent {
  /** What was paid up front, out of pocket. */
  downPayment: DecInput;
  /** Capital repaid: installments plus prepayments. */
  capitalPaid: DecInput;
  works: DecInput;
  interest: DecInput;
  insurances: DecInput;
  /** Deed, IMT, stamp duty and registration. */
  acquisitionCosts: DecInput;
  /** Loan fees and stamp tax on the installments. */
  feesAndTax: DecInput;
}

export interface SpentSlice {
  key: keyof MoneySpent;
  amount: string;
  /** Share of the total, in percent with 1 decimal; `0` when nothing was spent. */
  pct: string;
}

export interface SpentBreakdown {
  /** Down payment + capital paid + acquisition costs + works. */
  totalInvested: string;
  /** Interest + fees and tax + insurances. */
  costOfCredit: string;
  /** Invested + cost of credit: everything that left the household for the property. */
  totalSpent: string;
  slices: SpentSlice[];
}

/** "Para onde foi o dinheiro": the donut and the totals under it. */
export function spentBreakdown(spent: MoneySpent): SpentBreakdown {
  const invested = sum([spent.downPayment, spent.capitalPaid, spent.acquisitionCosts, spent.works]);
  const credit = sum([spent.interest, spent.feesAndTax, spent.insurances]);
  const total = invested.plus(credit);
  const order: (keyof MoneySpent)[] = [
    'capitalPaid',
    'downPayment',
    'works',
    'interest',
    'insurances',
    'acquisitionCosts',
    'feesAndTax',
  ];
  return {
    totalInvested: toPlain(invested),
    costOfCredit: toPlain(credit),
    totalSpent: toPlain(total),
    slices: order.map((key) => ({
      key,
      amount: toPlain(dec(spent[key])),
      pct: total.gt(0) ? toPlain(dec(spent[key]).div(total).times(100).toDecimalPlaces(1)) : '0',
    })),
  };
}

/** Share of the loan already repaid, in percent with 1 decimal. */
export function repaidPct(principal: DecInput, capitalPaid: DecInput): string {
  const base = dec(principal);
  return base.gt(0) ? toPlain(dec(capitalPaid).div(base).times(100).toDecimalPlaces(1)) : '0';
}

// --- Sale analysis --------------------------------------------------------------------------

export interface SaleInput {
  price: DecInput;
  /** Capital still owed to the bank. */
  debt: DecInput;
  sellingCostPct: DecInput;
  /** Everything spent on the property so far (`spentBreakdown().totalSpent`). */
  totalSpent: DecInput;
}

export interface SaleResult {
  sellingCosts: string;
  /** Price − debt − selling costs: what lands in the account. */
  netProceeds: string;
  /** Net proceeds − total spent; negative is a loss. */
  gain: string;
}

export function saleAnalysis(input: SaleInput): SaleResult {
  const price = dec(input.price);
  const costs = roundCents(price.times(input.sellingCostPct).div(100));
  const net = price.minus(input.debt).minus(costs);
  return {
    sellingCosts: toPlain(costs),
    netProceeds: toPlain(net),
    gain: toPlain(net.minus(input.totalSpent)),
  };
}

/**
 * The price at which selling gets back everything spent: (debt + spent) / (1 − selling cost %).
 * `null` when the selling costs eat the whole price (100 % or more).
 */
export function breakEvenPrice(
  input: Pick<SaleInput, 'debt' | 'sellingCostPct' | 'totalSpent'>,
): string | null {
  const keep = dec(1).minus(dec(input.sellingCostPct).div(100));
  if (keep.lte(0)) return null;
  return toPlain(roundCents(dec(input.debt).plus(input.totalSpent).div(keep)));
}

// --- Inflation -------------------------------------------------------------------------------

export interface YearlyRate {
  year: number;
  /** Consumer price change of the year, in percent. */
  ratePct: DecInput;
}

export interface InflationRow {
  year: number;
  ratePct: string;
  /** Product of (1 + rate) from the first year to this one. */
  index: string;
}

/**
 * Yearly rates **compounded** (the spreadsheet sums them): 1,27 % and 7,83 % make 9,20 %, not 9,10 %.
 * Rows are sorted by year; `index` has 4 decimals.
 */
export function compoundInflation(rates: readonly YearlyRate[]): {
  rows: InflationRow[];
  /** The last index. */
  factor: string;
  /** The compounded change in percent, 1 decimal (19,3 for the reference years). */
  compoundedPct: string;
  /** What summing the rates would say, in percent, 1 decimal (18,1): kept to show the difference. */
  summedPct: string;
} {
  const sorted = [...rates].sort((a, b) => a.year - b.year);
  let index = dec(1);
  const rows = sorted.map((rate) => {
    index = index.times(dec(1).plus(dec(rate.ratePct).div(100)));
    return {
      year: rate.year,
      ratePct: toPlain(dec(rate.ratePct)),
      index: toPlain(index.toDecimalPlaces(4)),
    };
  });
  return {
    rows,
    factor: toPlain(index),
    compoundedPct: toPlain(index.minus(1).times(100).toDecimalPlaces(1)),
    summedPct: toPlain(sum(sorted.map((rate) => rate.ratePct)).toDecimalPlaces(1)),
  };
}

export interface RealValue {
  /** The purchase price in today's money. */
  adjustedPrice: string;
  /** Value / price − 1, in percent, 1 decimal. */
  nominalPct: string;
  /** Value / adjusted price − 1, in percent, 1 decimal. */
  realPct: string;
}

/** What the purchase price is worth today and how much the property gained in nominal and real terms. */
export function realAppreciation(
  price: DecInput,
  value: DecInput,
  factor: DecInput,
): RealValue | null {
  const base = dec(price);
  if (base.lte(0)) return null;
  const adjusted = roundCents(base.times(factor));
  return {
    adjustedPrice: toPlain(adjusted),
    nominalPct: toPlain(dec(value).div(base).minus(1).times(100).toDecimalPlaces(1)),
    realPct: adjusted.gt(0)
      ? toPlain(dec(value).div(adjusted).minus(1).times(100).toDecimalPlaces(1))
      : '0',
  };
}

// --- Pace to a goal --------------------------------------------------------------------------

export interface Pace {
  /** Principal / goal months: what has to be repaid per month to finish on time. */
  goalPerMonth: string;
  /** Capital repaid per installment paid so far. */
  paidPerMonth: string;
  /** What the goal says should be repaid by now. */
  idealPaid: string;
  /** Capital paid − ideal: negative is behind the pace. */
  difference: string;
  ahead: boolean;
}

/** "Ritmo para o objetivo": counts the installments paid, not the ones the spreadsheet counted. */
export function paceToGoal(
  principal: DecInput,
  capitalPaid: DecInput,
  installmentsPaid: number,
  goalYears: number,
): Pace {
  const months = Math.max(1, Math.round(goalYears * 12));
  const perMonth = dec(principal).div(months).toDecimalPlaces(2);
  const ideal = perMonth.times(installmentsPaid);
  const difference = dec(capitalPaid).minus(ideal);
  return {
    goalPerMonth: toPlain(perMonth),
    paidPerMonth:
      installmentsPaid > 0
        ? toPlain(dec(capitalPaid).div(installmentsPaid).toDecimalPlaces(2))
        : '0',
    idealPaid: toPlain(ideal),
    difference: toPlain(difference),
    ahead: difference.gte(0),
  };
}

// --- Payoff simulator -------------------------------------------------------------------------

export interface SimulatorInput {
  /** Capital still owed. */
  balance: DecInput;
  /** Nominal annual rate in force today, in percent. */
  currentRatePct: DecInput;
  /** Installments left. */
  remainingMonths: number;
  /** Due date of the next installment. */
  nextDueDate: string;
  /** Spread over the index, in percent: the simulated rate is `euriborPct + spreadPct`. */
  spreadPct: DecInput;
  /** The index to try, in percent. */
  euriborPct: DecInput;
  prepayment?: { amount: DecInput; date: string; effect: PrepaymentEffect } | undefined;
  /** Pay everything off in this many years from the next installment; wins over the prepayment effect. */
  finishInYears?: number | null;
}

export interface SimulatedPlan {
  payment: string;
  /** Due date of the last installment; `null` when nothing is left to pay. */
  endDate: string | null;
  installments: number;
  interestToPay: string;
}

export interface SimulatorResult {
  rate: string;
  current: SimulatedPlan;
  simulated: SimulatedPlan;
  /** Simulated installment − current installment (negative when it drops). */
  extraPerMonth: string;
  /** Interest still to pay today − interest with the simulation (negative when it costs more). */
  interestSaved: string;
}

const MIN_RATE = dec(0);

function planOf(
  balance: DecInput,
  ratePct: DecInput,
  months: number,
  firstDueDate: string,
  events: readonly LoanEvent[],
): SimulatedPlan {
  if (dec(balance).lte(0) || months < 1) {
    return { payment: '0', endDate: null, installments: 0, interestToPay: '0' };
  }
  const { rows } = buildEventSchedule({
    balance,
    annualPct: ratePct,
    months,
    firstDueDate,
    events,
  });
  const first = rows[0];
  return {
    payment: first ? first.payment : '0',
    endDate: rows.at(-1)?.dueDate ?? null,
    installments: rows.length,
    interestToPay: toPlain(sum(rows.map((row) => row.interest))),
  };
}

/**
 * "What if": the index changes, a lump sum is paid early or the loan has to end sooner. Compares
 * the loan as it stands with the simulation; nothing is saved. Throws `RangeError` for terms that
 * cannot work (the engine refuses an installment below the interest).
 */
export function simulatePayoff(input: SimulatorInput): SimulatorResult {
  const rate = dec(input.euriborPct).plus(input.spreadPct);
  const simulatedRate = rate.lt(MIN_RATE) ? MIN_RATE : rate;
  const current = planOf(
    input.balance,
    input.currentRatePct,
    input.remainingMonths,
    input.nextDueDate,
    [],
  );

  const finish =
    input.finishInYears && input.finishInYears > 0
      ? Math.min(input.remainingMonths, Math.round(input.finishInYears * 12))
      : null;
  const months = finish ?? input.remainingMonths;
  const prepayment =
    input.prepayment && dec(input.prepayment.amount).gt(0) ? input.prepayment : null;
  // With a target the term is fixed, so the prepayment can only lower the installment.
  const events = prepayment
    ? [
        {
          kind: 'prepayment' as const,
          effectiveFrom: prepayment.date,
          amount: prepayment.amount,
          effect: finish ? ('reduce_installment' as const) : prepayment.effect,
        },
      ]
    : [];
  const simulated = planOf(input.balance, simulatedRate, months, input.nextDueDate, events);
  return {
    rate: toPlain(simulatedRate),
    current,
    simulated,
    extraPerMonth: toPlain(dec(simulated.payment).minus(current.payment)),
    interestSaved: toPlain(dec(current.interestToPay).minus(simulated.interestToPay)),
  };
}

export interface SensitivityRow {
  euriborPct: string;
  ratePct: string;
  payment: string;
  /** Payment − the installment at the current rate. */
  difference: string;
}

/** The installment if the index were `euriborPct + step` for each step (the "e se subir?" table). */
export function euriborSensitivity(
  input: Pick<
    SimulatorInput,
    'balance' | 'currentRatePct' | 'remainingMonths' | 'spreadPct' | 'euriborPct'
  >,
  steps: readonly DecInput[],
): SensitivityRow[] {
  const base = dec(frenchPayment(input.balance, input.currentRatePct, input.remainingMonths));
  return steps.map((step) => {
    const euribor = dec(input.euriborPct).plus(step);
    const rate = euribor.plus(input.spreadPct);
    const payment = dec(frenchPayment(input.balance, rate.lt(0) ? 0 : rate, input.remainingMonths));
    return {
      euriborPct: toPlain(euribor),
      ratePct: toPlain(rate.lt(0) ? dec(0) : rate),
      payment: toPlain(payment),
      difference: toPlain(payment.minus(base)),
    };
  });
}
