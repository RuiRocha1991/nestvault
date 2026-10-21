import { dec, sum, type Dec, type Money } from './decimal';
import type { Holding } from './positions';

export interface AllocationSlice {
  name: string;
  /** EUR value of the open positions in the slice. */
  value: Money;
}

/** Above this weight a single position is a concentration risk. */
export const TOP_POSITION_LIMIT = dec('0.25');
/** Above this combined weight the three largest positions are too much of the portfolio. */
export const TOP_THREE_LIMIT = dec('0.7');
/** Above this share in a foreign currency the exchange-rate exposure is relevant. */
export const FOREIGN_CURRENCY_LIMIT = dec('0.5');

/** Open positions grouped by `keyOf`, biggest slice first (ties keep the input order). */
export function allocationBy(
  open: readonly Holding[],
  keyOf: (holding: Holding) => string,
): AllocationSlice[] {
  const slices = new Map<string, Dec>();
  for (const holding of open) {
    const key = keyOf(holding);
    slices.set(key, (slices.get(key) ?? dec(0)).plus(holding.value));
  }
  return [...slices.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value.comparedTo(a.value));
}

export type DiagnosticCode = 'topPosition' | 'topThree' | 'foreignCurrency' | 'diversification';

export interface Diagnostic {
  code: DiagnosticCode;
  /** True when the check needs attention. */
  bad: boolean;
  /** Weights are fractions (0.727 = 72.7 %). */
  weight?: Dec;
  /** The largest position (`topPosition`). */
  assetId?: string;
  positions?: number;
  sectors?: number;
  regions?: number;
}

export interface DiagnosticsAttributes {
  sector: (holding: Holding) => string;
  region: (holding: Holding) => string;
}

/**
 * The portfolio checks of the Análise tab: concentration, top three, foreign currency and how many
 * sectors and regions the positions cover. Empty without open positions.
 */
export function portfolioDiagnostics(
  open: readonly Holding[],
  attributes: DiagnosticsAttributes,
): Diagnostic[] {
  const ranked = [...open].sort((a, b) => b.weight.comparedTo(a.weight));
  const [first] = ranked;
  if (!first) return [];
  const topThree = sum(ranked.slice(0, 3).map((h) => h.weight));
  const foreign = sum(open.filter((h) => h.currency !== 'EUR').map((h) => h.weight));
  return [
    {
      code: 'topPosition',
      bad: first.weight.gt(TOP_POSITION_LIMIT),
      weight: first.weight,
      assetId: first.assetId,
    },
    { code: 'topThree', bad: topThree.gt(TOP_THREE_LIMIT) && open.length > 3, weight: topThree },
    { code: 'foreignCurrency', bad: foreign.gt(FOREIGN_CURRENCY_LIMIT), weight: foreign },
    {
      code: 'diversification',
      bad: false,
      positions: open.length,
      sectors: new Set(open.map(attributes.sector)).size,
      regions: new Set(open.map(attributes.region)).size,
    },
  ];
}
