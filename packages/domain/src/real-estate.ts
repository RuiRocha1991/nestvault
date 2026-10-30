import { dec, sum, type DecInput, type Money } from './decimal';
import { latestValuation, type Valuation } from './property';

/**
 * Real estate in net worth (PRD "Real estate and loans"): what the properties are worth to the
 * household and what the loans still owe, on any date. Pure: decimal strings in, `Dec` out.
 */

export interface PropertyWorth {
  purchaseDate: string;
  purchasePrice: DecInput;
  /** The share of the property that belongs to the pool's holders, in percent (100 when all of it). */
  sharePct: DecInput;
  /** A property left out of net worth counts for nothing, and so do its loans. */
  includeInNetWorth: boolean;
  valuations: readonly Valuation[];
}

export interface LoanLiability {
  /** The property the loan is for, `null` for a car or personal loan. */
  propertyId: string | null;
  startDate: string;
  principal: DecInput;
  /** Actual installments: the capital of those due on or before a date has been paid. */
  installments: readonly { dueDate: string; capital: DecInput }[];
  /** Capital paid off early. */
  prepayments: readonly { date: string; amount: DecInput }[];
}

export interface RealEstateData {
  /** By property id. */
  properties: ReadonlyMap<string, PropertyWorth>;
  loans: readonly LoanLiability[];
}

const ZERO = dec(0);

/**
 * The household's share of a property on `date`: the newest valuation up to that date, or the
 * purchase price from the purchase date when there is none, times the share. Nothing before the
 * purchase.
 */
export function propertyValueAt(property: PropertyWorth, date: string): Money {
  if (!property.includeInNetWorth || property.purchaseDate > date) return ZERO;
  const known = latestValuation(property.valuations.filter((entry) => entry.date <= date));
  const value = known ? dec(known.value) : dec(property.purchasePrice);
  return value.times(property.sharePct).div(100);
}

/** What a loan still owes on `date`: the principal minus the capital and prepayments up to it. */
export function loanOutstandingAt(loan: LoanLiability, date: string): Money {
  if (loan.startDate > date) return ZERO;
  const paid = sum(
    loan.installments.filter((row) => row.dueDate <= date).map((row) => row.capital),
  );
  const prepaid = sum(loan.prepayments.filter((row) => row.date <= date).map((row) => row.amount));
  const owed = dec(loan.principal).minus(paid).minus(prepaid);
  return owed.isNegative() ? ZERO : owed;
}

export interface RealEstateWorth {
  /** The properties' value to the household. */
  realEstate: Money;
  /** The loans' outstanding balances. */
  liabilities: Money;
}

/** Properties and liabilities on `date`; a loan of a property left out of net worth is left out too. */
export function realEstateAt(data: RealEstateData, date: string): RealEstateWorth {
  const included = (propertyId: string | null) =>
    propertyId === null || (data.properties.get(propertyId)?.includeInNetWorth ?? true);
  return {
    realEstate: sum(
      [...data.properties.values()].map((property) => propertyValueAt(property, date)),
    ),
    liabilities: sum(
      data.loans
        .filter((loan) => included(loan.propertyId))
        .map((loan) => loanOutstandingAt(loan, date)),
    ),
  };
}

/** True when there is anything to show: a property or a loan. */
export const hasRealEstate = (data: RealEstateData): boolean =>
  data.properties.size > 0 || data.loans.length > 0;
