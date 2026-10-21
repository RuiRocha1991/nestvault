import type { InvestmentOpRow } from '@nestvault/db';
import {
  allocationBy,
  cashEffect,
  cashEffectNative,
  computeHoldings,
  dec,
  dividendsForecast,
  dividendsReceived,
  lastMonths,
  monthEnd,
  nextMonths,
  portfolioDiagnostics,
  sum,
  toPlain,
  type Dec,
  type FxRates,
  type Holding,
  type InvestmentAsset,
  type InvestmentOp,
} from '@nestvault/domain';
import { z } from 'zod';

import { toInvestmentOp } from './domain';
import { OpDto, toOpDto } from './schemas';

/** The monthly performance series reaches back this many months at most. */
export const PERFORMANCE_MONTHS = 36;

const Decimal = z.string();

export const HoldingDto = z.object({
  key: z.string(),
  assetId: z.uuid(),
  accountId: z.uuid().nullable(),
  subAccountId: z.uuid().nullable(),
  currency: z.string(),
  qty: Decimal,
  /** Average price per unit and current price, in the asset's currency. */
  avg: Decimal,
  price: Decimal,
  /** Native (asset currency) value, gain, dividends and total return. */
  valueN: Decimal,
  gainN: Decimal,
  divsN: Decimal,
  totalN: Decimal,
  /** EUR figures. */
  value: Decimal,
  cost: Decimal,
  gain: Decimal,
  /** Fractions: 0.113 is 11.3 %. */
  gainPct: Decimal,
  divs: Decimal,
  total: Decimal,
  /** Expected annual dividend income, EUR. */
  income: Decimal,
  /** `income / value` and `income / cost` (yield on cost), fractions. */
  yld: Decimal,
  yoc: Decimal,
  weight: Decimal,
  isOpen: z.boolean(),
});
export type HoldingDto = z.infer<typeof HoldingDto>;

const SliceDto = z.object({ name: z.string(), value: Decimal });

export const ViewOpDto = OpDto.extend({
  /** What the operation moves in the asset's currency and in EUR (buys negative). */
  native: Decimal,
  eur: Decimal,
});
export type ViewOpDto = z.infer<typeof ViewOpDto>;

export const PortfolioViewDto = z.object({
  asOf: z.iso.date(),
  portfolioId: z.uuid().nullable(),
  /** Open and closed positions merged per asset, and kept per asset + account + sub-account. */
  holdings: z.array(HoldingDto),
  positions: z.array(HoldingDto),
  /** Operations of the scope, newest first (at most the first 1000). */
  ops: z.array(ViewOpDto),
  /** Net dividends received per month, the last 12 months ending with the current one (EUR). */
  received: z.array(z.object({ month: z.string(), value: Decimal })),
  /** Expected dividends per month, the next 12 months starting with the current one (EUR). */
  forecast: z.array(
    z.object({
      month: z.string(),
      value: Decimal,
      items: z.array(z.object({ assetId: z.uuid(), value: Decimal })),
    }),
  ),
  /** Expected annual income net of withholding tax (EUR). */
  incomeNet: Decimal,
  /** Position value and cost at the end of each month (EUR), oldest first. */
  performance: z.object({
    months: z.array(z.string()),
    value: z.array(Decimal),
    invested: z.array(Decimal),
  }),
  allocation: z.object({
    type: z.array(SliceDto),
    sector: z.array(SliceDto),
    region: z.array(SliceDto),
    currency: z.array(SliceDto),
  }),
  diagnostics: z.array(
    z.object({
      code: z.enum(['topPosition', 'topThree', 'foreignCurrency', 'diversification']),
      bad: z.boolean(),
      weight: Decimal.nullable(),
      assetId: z.uuid().nullable(),
      positions: z.number().int().nullable(),
      sectors: z.number().int().nullable(),
      regions: z.number().int().nullable(),
    }),
  ),
});
export type PortfolioViewDto = z.infer<typeof PortfolioViewDto>;

export interface ViewAsset extends InvestmentAsset {
  type: string;
  sector: string | null;
  region: string | null;
}

export interface ViewInput {
  asOf: string;
  portfolioId: string | null;
  opRows: readonly InvestmentOpRow[];
  assets: readonly ViewAsset[];
  rates: FxRates;
  /** The newest price of every asset dated on or before each month end (oldest month first). */
  historicPrices: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

const OPS_MAX = 1000;

export function toHoldingDto(h: Holding): HoldingDto {
  const ratio = (a: Dec, b: Dec) => (b.isZero() ? '0' : toPlain(a.div(b)));
  return {
    key: h.key,
    assetId: h.assetId,
    accountId: h.accountId,
    subAccountId: h.subAccountId,
    currency: h.currency,
    qty: toPlain(h.qty),
    avg: toPlain(h.avg),
    price: toPlain(h.price),
    valueN: toPlain(h.valueN),
    gainN: toPlain(h.gainN),
    divsN: toPlain(h.divsN),
    totalN: toPlain(h.totalN),
    value: toPlain(h.value),
    cost: toPlain(h.cost),
    gain: toPlain(h.gain),
    gainPct: toPlain(h.gainPct),
    divs: toPlain(h.divs),
    total: toPlain(h.total),
    income: toPlain(h.income),
    yld: ratio(h.income, h.value),
    yoc: ratio(h.income, h.cost),
    weight: toPlain(h.weight),
    isOpen: h.isOpen,
  };
}

/** Everything the Portfolios screen shows below the summary, computed by the domain. */
export function buildPortfolioView(input: ViewInput): PortfolioViewDto {
  const { asOf, portfolioId, assets, rates } = input;
  const scope = { asOf, today: asOf, ...(portfolioId ? { portfolioIds: [portfolioId] } : {}) };
  const allOps = input.opRows.map(toInvestmentOp);
  const byId = new Map(assets.map((asset) => [asset.id, asset]));

  const merged = computeHoldings(allOps, assets, rates, scope);
  const open = merged.filter((h) => h.isOpen);
  const perPosition = computeHoldings(allOps, assets, rates, { ...scope, groupBy: 'position' });

  const attribute = (pick: (a: ViewAsset) => string | null) => (h: Holding) =>
    (byId.get(h.assetId) && pick(byId.get(h.assetId) as ViewAsset)) ?? '';
  const slices = (pick: (a: ViewAsset) => string | null) =>
    allocationBy(open, attribute(pick)).map(({ name, value }) => ({
      name,
      value: toPlain(value),
    }));

  const inScope = (op: InvestmentOp) => !portfolioId || op.portfolioId === portfolioId;
  const opRows = input.opRows.filter((row) => inScope(toInvestmentOp(row))).slice(0, OPS_MAX);
  const ops = opRows.map((row) => {
    const op: InvestmentOp = toInvestmentOp(row);
    const asset = byId.get(row.assetId);
    return {
      ...toOpDto(row),
      native: toPlain(cashEffectNative(op, asset, rates)),
      eur: toPlain(cashEffect(op, asset, rates)),
    };
  });

  const receivedMonths = lastMonths(12, asOf);
  const received = dividendsReceived(
    allOps,
    assets,
    rates,
    receivedMonths,
    portfolioId ? { portfolioIds: [portfolioId] } : {},
  );
  const forecast = dividendsForecast(open, nextMonths(12, asOf));

  const firstOp = allOps
    .filter(inScope)
    .reduce<string | null>(
      (first, op) => (first === null || op.date < first ? op.date : first),
      null,
    );
  const months = firstOp
    ? lastMonths(PERFORMANCE_MONTHS, asOf).filter((month) => month >= firstOp.slice(0, 7))
    : [];
  const points = months.map((month) => {
    const end = month === asOf.slice(0, 7) ? asOf : monthEnd(month);
    const prices = input.historicPrices.get(month);
    const atMonth = assets.map((asset) => ({ ...asset, price: prices?.get(asset.id) ?? '0' }));
    const holdings = computeHoldings(allOps, atMonth, rates, { ...scope, asOf: end, today: end });
    const live = holdings.filter((h) => h.isOpen);
    return { value: sum(live.map((h) => h.value)), cost: sum(live.map((h) => h.cost)) };
  });

  const diagnostics = portfolioDiagnostics(open, {
    sector: attribute((a) => a.sector),
    region: attribute((a) => a.region),
  });

  return {
    asOf,
    portfolioId,
    holdings: merged.map(toHoldingDto),
    positions: perPosition.map(toHoldingDto),
    ops,
    received: receivedMonths.map((month, i) => ({
      month,
      value: toPlain(received[i] ?? dec(0)),
    })),
    forecast: forecast.map((m) => ({
      month: m.month,
      value: toPlain(m.value),
      items: m.items.map((item) => ({ assetId: item.assetId, value: toPlain(item.value) })),
    })),
    incomeNet: toPlain(sum(open.map((h) => h.income.times(dec(1).minus(h.wht))))),
    performance: {
      months,
      value: points.map((p) => toPlain(p.value)),
      invested: points.map((p) => toPlain(p.cost)),
    },
    allocation: {
      type: slices((a) => a.type),
      sector: slices((a) => a.sector),
      region: slices((a) => a.region),
      currency: allocationBy(open, (h) => h.currency).map(({ name, value }) => ({
        name,
        value: toPlain(value),
      })),
    },
    diagnostics: diagnostics.map((d) => ({
      code: d.code,
      bad: d.bad,
      weight: d.weight ? toPlain(d.weight) : null,
      assetId: d.assetId ?? null,
      positions: d.positions ?? null,
      sectors: d.sectors ?? null,
      regions: d.regions ?? null,
    })),
  };
}
