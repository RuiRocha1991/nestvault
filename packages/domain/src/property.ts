import { compare, dec, sub, sum, toPlain, type DecInput } from './decimal';

/**
 * Real estate (PRD "Real estate and loans"): what is paid to acquire a property and what it is
 * worth. Pure: money in and out as decimal strings, never JS floats.
 */

/** The itemized costs of signing the deed (EUR). */
export interface AcquisitionCosts {
  deed: DecInput;
  imt: DecInput;
  stampDuty: DecInput;
  registration: DecInput;
  bankFees: DecInput;
}

/** Sum of the itemized acquisition costs. */
export function acquisitionCostsTotal(costs: AcquisitionCosts): string {
  return toPlain(sum([costs.deed, costs.imt, costs.stampDuty, costs.registration, costs.bankFees]));
}

/** What the bank lends: price minus the down payment. */
export function loanAmount(price: DecInput, downPayment: DecInput): string {
  return toPlain(sub(price, downPayment));
}

/** Price + acquisition costs: what the property cost to get (the works come on top of it, later). */
export function purchaseOutlay(price: DecInput, costs: AcquisitionCosts): string {
  return toPlain(dec(price).plus(acquisitionCostsTotal(costs)));
}

export interface Valuation {
  date: string;
  value: DecInput;
}

/** The newest valuation (by date; the one added last wins a tie), `undefined` without any. */
export function latestValuation<T extends Valuation>(valuations: readonly T[]): T | undefined {
  let latest: T | undefined;
  for (const valuation of valuations) {
    if (!latest || valuation.date >= latest.date) latest = valuation;
  }
  return latest;
}

/** True when the ownership shares (percent) of the holders add up to exactly 100. */
export function sharesAddUpTo100(shares: readonly DecInput[]): boolean {
  return shares.length > 0 && compare(sum(shares), 100) === 0;
}
