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

/** Per-currency totals (`{ USD: 10 }`), as the portfolio summary reports them. */
export type ByCurrency = Record<string, Dec>;

export function addTo(map: ByCurrency, currency: string, amount: DecInput): void {
  map[currency] = (map[currency] ?? dec(0)).plus(amount);
}

/** Converts per-currency totals to EUR with the given rates. */
export function sumToEur(map: Readonly<ByCurrency>, rates: FxRates): Money {
  return Object.entries(map).reduce(
    (total, [currency, amount]) => total.plus(toEur(amount, currency, rates)),
    dec(0),
  );
}

/** Where a resolved rate comes from. `default` is the seed constant, used when no row is dated. */
export type FxRateSource = 'pool' | 'seed' | 'ecb' | 'manual' | 'default';

export interface MarketFxRate {
  currency: string;
  /** EUR per unit, as a decimal string. */
  rate: string;
  /** `yyyy-mm-dd`. */
  date: string;
  source: Exclude<FxRateSource, 'pool' | 'default'>;
}

export interface ResolvedFxRate {
  currency: string;
  /** What the pool uses: its own override, else the market rate. */
  rate: string;
  /** The rate without the pool's override. */
  marketRate: string;
  source: FxRateSource;
  /** The day of the market rate; `null` for the seed constant. */
  date: string | null;
}

/** True for a finite rate above zero; text that is not a number is not usable (never throws). */
const isUsableRate = (value: string) => {
  try {
    const rate = dec(value);
    return rate.isFinite() && rate.gt(0);
  } catch {
    return false;
  }
};

/**
 * The rate of every known currency for one pool: its override, else the newest market rate the
 * caller passed (already limited to the day asked for), else the seed constant. A malformed or
 * non-positive override is ignored, like `fx` ignores a bad rate. Sorted by currency.
 */
export function resolveFxRates(input: {
  market: readonly MarketFxRate[];
  overrides: Readonly<Record<string, string>>;
}): ResolvedFxRate[] {
  const market = new Map(input.market.map((entry) => [entry.currency, entry]));
  const currencies = new Set([
    ...market.keys(),
    ...Object.keys(input.overrides),
    ...Object.keys(DEFAULT_FX_RATES),
  ]);
  return [...currencies].sort().flatMap((currency): ResolvedFxRate[] => {
    const found = market.get(currency);
    const fallback = DEFAULT_FX_RATES[currency];
    const base =
      found && isUsableRate(found.rate)
        ? { rate: dec(found.rate).toString(), source: found.source, date: found.date }
        : fallback !== undefined
          ? { rate: dec(fallback).toString(), source: 'default' as const, date: null }
          : undefined;
    const override = input.overrides[currency];
    const own = override !== undefined && isUsableRate(override) ? dec(override).toString() : null;
    // A currency with an override only has no market rate to fall back on: the override is both.
    if (!base)
      return own === null
        ? []
        : [{ currency, rate: own, marketRate: own, source: 'pool', date: null }];
    return [
      {
        currency,
        rate: own ?? base.rate,
        marketRate: base.rate,
        source: own === null ? base.source : 'pool',
        date: base.date,
      },
    ];
  });
}

/** The `FxRates` map the calculations take, from resolved rates. */
export function toFxRates(resolved: readonly ResolvedFxRate[]): FxRates {
  return Object.fromEntries(resolved.map((entry) => [entry.currency, entry.rate]));
}
