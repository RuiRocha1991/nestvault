import { dec, mul, type Dec, type DecInput, type Money } from './decimal';

/** EUR per one unit of the currency, as decimal strings. EUR itself is implicit (1). */
export type FxRates = Readonly<Record<string, string>>;

/** Seed values for a new pool only; calculations always take the rates they are given. */
export const DEFAULT_FX_RATES: FxRates = { USD: '0.92', GBP: '1.17', CHF: '1.06' };

/** EUR per unit. EUR and an unknown or invalid rate count as 1, like the prototype's `fx`. */
export function fx(currency: string | null | undefined, rates: FxRates): Dec {
  if (!currency || currency === 'EUR') return dec(1);
  const rate = rates[currency];
  if (rate === undefined) return dec(1);
  const value = dec(rate);
  return value.isFinite() && value.gt(0) ? value : dec(1);
}

export function toEur(
  amount: DecInput,
  currency: string | null | undefined,
  rates: FxRates,
): Money {
  return mul(amount, fx(currency, rates));
}
