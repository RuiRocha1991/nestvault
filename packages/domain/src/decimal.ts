import Decimal from 'decimal.js';

/**
 * One Decimal class for the whole domain: 40 significant digits (far more than numeric(18,4) or
 * numeric(20,8) need) and half-up rounding, so 2.675 rounds to 2.68 like the prototype's cents.
 */
const D = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -40,
  toExpPos: 40,
});
export type Dec = Decimal;
/** Money and quantities are both decimals; the aliases document the intent (cents vs 8 places). */
export type Money = Dec;
export type Qty = Dec;

export type DecInput = string | number | Dec;

/** Builds a decimal. Strings are exact; prefer them over numbers, which are already floats. */
export function dec(value: DecInput): Dec {
  return new D(value);
}

export function add(a: DecInput, b: DecInput): Dec {
  return dec(a).plus(b);
}

export function sub(a: DecInput, b: DecInput): Dec {
  return dec(a).minus(b);
}

export function mul(a: DecInput, b: DecInput): Dec {
  return dec(a).times(b);
}

/** Throws on a zero divisor instead of returning Infinity or NaN. */
export function div(a: DecInput, b: DecInput): Dec {
  const divisor = dec(b);
  if (divisor.isZero()) throw new RangeError('Division by zero');
  return dec(a).div(divisor);
}

export function sum(values: Iterable<DecInput>): Dec {
  let total = dec(0);
  for (const value of values) total = total.plus(value);
  return total;
}

/** Negative, zero or positive, like Array.sort expects. */
export function compare(a: DecInput, b: DecInput): number {
  return dec(a).comparedTo(b);
}

export function roundTo(value: DecInput, places: number): Dec {
  return dec(value).toDecimalPlaces(places, Decimal.ROUND_HALF_UP);
}

/** Half-up to cents (money shown and summed). */
export function roundCents(value: DecInput): Dec {
  return roundTo(value, 2);
}

/** Decimal string without an exponent, ready for a numeric column or JSON; `-0` becomes `0`. */
export function toPlain(value: DecInput): string {
  const x = dec(value);
  return x.isZero() ? '0' : x.toFixed();
}
