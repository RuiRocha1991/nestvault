/** The currencies the parameters card edits, in the order the mockup shows them. */
export const FX_CURRENCIES = ['USD', 'GBP', 'CHF'] as const;
export type FxCurrency = (typeof FX_CURRENCIES)[number];

/** Where the rate in force comes from, as the FX API reports it. */
export type FxSource = 'pool' | 'seed' | 'ecb' | 'manual' | 'default';

export interface FxRateView {
  rate: string;
  marketRate: string;
  source: FxSource;
  /** `yyyy-mm-dd` of the rate, null for a default. */
  date: string | null;
}

export interface ParametersForm {
  rates: Record<FxCurrency, string>;
  depositTax: string;
  dividendTax: string;
  transferWindowDays: string;
}

/** "0,92" (what people type in pt-PT) and "0.92" are the same number; spaces are ignored. */
export const toDecimal = (text: string) => text.replace(/\s/g, '').replace(',', '.');

/** The decimal string the API sends, shown the pt-PT way. */
export const toText = (decimal: string) => decimal.replace('.', ',');

export interface ParametersPatch {
  depositTax: string;
  dividendTax: string;
  transferWindowDays: number;
  fxOverrides: Record<string, string>;
}

/**
 * The PATCH body for the form. A rate equal to the market rate is not an override, so a market
 * update still reaches the pool; the map always carries every override the pool should keep.
 * Null when the window is not a whole number (the server checks the rest and answers 400).
 */
export function buildPatch(
  form: ParametersForm,
  market: Readonly<Record<string, string>>,
  overridesToKeep: Readonly<Record<string, string>> = {},
): ParametersPatch | null {
  const days = form.transferWindowDays.trim();
  if (!/^\d{1,2}$/.test(days)) return null;
  const fxOverrides: Record<string, string> = {};
  for (const [ccy, rate] of Object.entries(overridesToKeep)) {
    if (!(FX_CURRENCIES as readonly string[]).includes(ccy)) fxOverrides[ccy] = rate;
  }
  for (const ccy of FX_CURRENCIES) {
    const rate = toDecimal(form.rates[ccy]);
    if (Number(rate) !== Number(market[ccy])) fxOverrides[ccy] = rate;
  }
  return {
    depositTax: toDecimal(form.depositTax),
    dividendTax: toDecimal(form.dividendTax),
    transferWindowDays: Number(days),
    fxOverrides,
  };
}
