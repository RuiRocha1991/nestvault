import {
  convertCurrency,
  dec,
  fromEur,
  toFxRates,
  toPlain,
  type FxRates,
  type ResolvedFxRate,
} from '@nestvault/domain';
import { z } from 'zod';

/** `?currency=`: the portfolio's own currency (default) or the pool's base currency. */
export const DisplayMode = z.enum(['portfolio', 'base']);
export type DisplayMode = z.infer<typeof DisplayMode>;

/** The rate of one foreign currency that the figures were converted with. */
export const DisplayRateDto = z.object({
  currency: z.string(),
  /** EUR per one unit of `currency`. */
  rate: z.string(),
  source: z.enum(['pool', 'seed', 'ecb', 'manual', 'default']),
  /** Day of the market rate; null when there is none. */
  date: z.string().nullable(),
});

/** In which currency the figures of a response are, and the rates that got them there. */
export const DisplayDto = z.object({
  mode: DisplayMode,
  /** The currency of every converted amount of the response. */
  currency: z.string(),
  baseCurrency: z.string(),
  /** Null for "all portfolios". */
  portfolioCurrency: z.string().nullable(),
  /** True when the choice cannot change (all portfolios: only the base currency makes sense). */
  fixed: z.boolean(),
  rates: z.array(DisplayRateDto),
});
export type DisplayDto = z.infer<typeof DisplayDto>;

/**
 * The currency of a response: the portfolio's own for `portfolio` (when one is selected), else
 * the base currency. "All portfolios" mix currencies, so they are always in the base currency.
 */
export function resolveDisplay(input: {
  mode: DisplayMode | undefined;
  portfolioCurrency: string | null;
  baseCurrency: string;
  resolved: readonly ResolvedFxRate[];
  /** Currencies of the figures that get converted (positions). */
  involved: Iterable<string>;
}): { display: DisplayDto; rates: FxRates } {
  const { portfolioCurrency, baseCurrency } = input;
  const fixed = portfolioCurrency === null;
  const mode: DisplayMode = fixed ? 'base' : (input.mode ?? 'portfolio');
  const currency = mode === 'portfolio' && portfolioCurrency ? portfolioCurrency : baseCurrency;
  const wanted = new Set([...input.involved, currency]);
  wanted.delete('EUR');
  const rates = input.resolved
    .filter((entry) => wanted.has(entry.currency))
    .map(({ currency: ccy, rate, source, date }) => ({ currency: ccy, rate, source, date }));
  return {
    display: { mode, currency, baseCurrency, portfolioCurrency, fixed, rates },
    rates: toFxRates(input.resolved),
  };
}

/** A decimal string of EUR, expressed in the display currency. */
export const rebase =
  (currency: string, rates: FxRates) =>
  (amount: string): string =>
    toPlain(fromEur(dec(amount), currency, rates));

/**
 * An amount in `from` expressed in the currency of a response, with the rates it carries (for the
 * page's tables). Needs the rate of `from` among `display.rates`, else it counts as EUR.
 */
export function toDisplay(amount: string, from: string, display: DisplayDto): string {
  const rates = Object.fromEntries(display.rates.map((entry) => [entry.currency, entry.rate]));
  return toPlain(convertCurrency(dec(amount), from, display.currency, rates));
}
