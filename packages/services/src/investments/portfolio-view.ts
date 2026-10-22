import type { InvestmentOpRow } from '@nestvault/db';
import {
  allocationBy,
  cashEffect,
  cashEffectNative,
  computeHoldings,
  dec,
  dividendsForecast,
  dividendsReceived,
  hasDividends,
  lastMonths,
  monthEnd,
  nextMonths,
  portfolioDiagnostics,
  sum,
  toEur,
  toPlain,
  type Dec,
  type FxRates,
  type Holding,
  type InvestmentAsset,
  type InvestmentOp,
  type ResolvedFxRate,
} from '@nestvault/domain';
import { z } from 'zod';

import type { AccountMonth } from './account-series';
import { DisplayDto, rebase, resolveDisplay, type DisplayMode } from './display-currency';
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
  /** Figures in the display currency of the response (`display.currency`). */
  value: Decimal,
  cost: Decimal,
  gain: Decimal,
  /** Fractions: 0.113 is 11.3 %. */
  gainPct: Decimal,
  divs: Decimal,
  total: Decimal,
  /** Expected annual dividend income, display currency. */
  income: Decimal,
  /** `income / value` and `income / cost` (yield on cost), fractions. */
  yld: Decimal,
  yoc: Decimal,
  weight: Decimal,
  /** Change since the previous price: native, display currency and as a fraction of that price. */
  dayN: Decimal,
  day: Decimal,
  dayPct: Decimal,
  isOpen: z.boolean(),
});
export type HoldingDto = z.infer<typeof HoldingDto>;

const SliceDto = z.object({ name: z.string(), value: Decimal });

export const ViewOpDto = OpDto.extend({
  /** What the operation moves in the asset's currency and in the display currency (buys negative). */
  native: Decimal,
  converted: Decimal,
});
export type ViewOpDto = z.infer<typeof ViewOpDto>;

export const PortfolioViewDto = z.object({
  asOf: z.iso.date(),
  portfolioId: z.uuid().nullable(),
  /** The currency of every converted figure below and the rates that got them there. */
  display: DisplayDto,
  /**
   * Whether the scope has any dividend: a dividend operation, or an open position expected to pay.
   * The screens show nothing about dividends when it is false.
   */
  hasDividends: z.boolean(),
  /** Daily gain of the open positions (display currency) and as a fraction of yesterday's value. */
  dayGain: Decimal,
  dayGainPct: Decimal,
  /** Open and closed positions merged per asset, and kept per asset + account + sub-account. */
  holdings: z.array(HoldingDto),
  positions: z.array(HoldingDto),
  /** Operations of the scope, newest first (at most the first 1000). */
  ops: z.array(ViewOpDto),
  /** Net dividends received per month, the last 12 months ending with the current one (display currency). */
  received: z.array(z.object({ month: z.string(), value: Decimal })),
  /** Expected dividends per month, the next 12 months starting with the current one (display currency). */
  forecast: z.array(
    z.object({
      month: z.string(),
      value: Decimal,
      items: z.array(z.object({ assetId: z.uuid(), value: Decimal })),
    }),
  ),
  /** Expected annual income net of withholding tax (display currency). */
  incomeNet: Decimal,
  /** Position value and cost at the end of each month (display currency), oldest first. */
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
  /** The price before the newest one, per asset: what the daily change is measured against. */
  previousPrices?: ReadonlyMap<string, string>;
  /** The pool's resolved rates (with source and date) and what picks the display currency. */
  resolved: readonly ResolvedFxRate[];
  mode: DisplayMode | undefined;
  portfolioCurrency: string | null;
  baseCurrency: string;
  /** Currencies of the accounts linked to the scope (their rates are listed too). */
  accountCurrencies?: readonly string[];
  /** Month-end value and interest of the accounts linked to the scope (EUR), by `yyyy-mm`. */
  accountSeries?: ReadonlyMap<string, AccountMonth>;
  /** The first day any linked account has data; the chart starts there when it is earlier. */
  accountsFrom?: string | null;
}

const OPS_MAX = 1000;

/** What a holding moved since the previous price: native, EUR and the price change as a fraction. */
function dayChange(h: Holding, previous: string | undefined, rates: FxRates) {
  if (previous === undefined || dec(previous).isZero()) {
    return { dayN: dec(0), day: dec(0), dayPct: dec(0) };
  }
  const move = h.price.minus(previous);
  const dayN = h.qty.times(move);
  return { dayN, day: toEur(dayN, h.currency, rates), dayPct: move.div(previous) };
}

export function toHoldingDto(
  h: Holding,
  day: ReturnType<typeof dayChange> = { dayN: dec(0), day: dec(0), dayPct: dec(0) },
): HoldingDto {
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
    dayN: toPlain(day.dayN),
    day: toPlain(day.day),
    dayPct: toPlain(day.dayPct),
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
      converted: toPlain(cashEffect(op, asset, rates)),
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
  const first = [firstOp, input.accountsFrom ?? null]
    .filter((date): date is string => !!date)
    .reduce<string | null>((min, date) => (min === null || date < min ? date : min), null);
  const months = first
    ? lastMonths(PERFORMANCE_MONTHS, asOf).filter((month) => month >= first.slice(0, 7))
    : [];
  const points = months.map((month) => {
    const end = month === asOf.slice(0, 7) ? asOf : monthEnd(month);
    const prices = input.historicPrices.get(month);
    const atMonth = assets.map((asset) => ({ ...asset, price: prices?.get(asset.id) ?? '0' }));
    const holdings = computeHoldings(allOps, atMonth, rates, { ...scope, asOf: end, today: end });
    const live = holdings.filter((h) => h.isOpen);
    // The linked accounts add their balance to the value and, without their interest, to the cost.
    const account = input.accountSeries?.get(month);
    const accountValue = dec(account?.value ?? 0);
    const accountInterest = dec(account?.interest ?? 0);
    return {
      value: sum(live.map((h) => h.value)).plus(accountValue),
      cost: sum(live.map((h) => h.cost))
        .plus(accountValue)
        .minus(accountInterest),
    };
  });

  const { display } = resolveDisplay({
    ...input,
    involved: [...merged.map((h) => h.currency), ...(input.accountCurrencies ?? [])],
  });
  const diagnostics = portfolioDiagnostics(open, {
    sector: attribute((a) => a.sector),
    region: attribute((a) => a.region),
  });

  const dayOf = (h: Holding) => dayChange(h, input.previousPrices?.get(h.assetId), rates);
  const dayGain = sum(open.map((h) => dayOf(h).day));
  const yesterday = sum(open.map((h) => h.value)).minus(dayGain);

  const eurView: PortfolioViewDto = {
    asOf,
    portfolioId,
    display,
    hasDividends: hasDividends(allOps.filter(inScope), assets, open),
    dayGain: toPlain(dayGain),
    dayGainPct: yesterday.isZero() ? '0' : toPlain(dayGain.div(yesterday)),
    holdings: merged.map((h) => toHoldingDto(h, dayOf(h))),
    positions: perPosition.map((h) => toHoldingDto(h, dayOf(h))),
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
  return rebaseView(eurView, rates);
}

/**
 * The same view with every EUR amount expressed in the display currency (`fromEur` with the
 * pool's rates, decimal arithmetic). Native amounts, prices, ratios and weights stay as they are.
 */
export function rebaseView(view: PortfolioViewDto, rates: FxRates): PortfolioViewDto {
  const to = rebase(view.display.currency, rates);
  const holding = (h: HoldingDto): HoldingDto => ({
    ...h,
    value: to(h.value),
    cost: to(h.cost),
    gain: to(h.gain),
    divs: to(h.divs),
    total: to(h.total),
    income: to(h.income),
    day: to(h.day),
  });
  const slice = (s: { name: string; value: string }) => ({ ...s, value: to(s.value) });
  return {
    ...view,
    dayGain: to(view.dayGain),
    holdings: view.holdings.map(holding),
    positions: view.positions.map(holding),
    ops: view.ops.map((op) => ({ ...op, converted: to(op.converted) })),
    received: view.received.map((m) => ({ ...m, value: to(m.value) })),
    forecast: view.forecast.map((m) => ({
      ...m,
      value: to(m.value),
      items: m.items.map((item) => ({ ...item, value: to(item.value) })),
    })),
    incomeNet: to(view.incomeNet),
    performance: {
      ...view.performance,
      value: view.performance.value.map(to),
      invested: view.performance.invested.map(to),
    },
    allocation: {
      type: view.allocation.type.map(slice),
      sector: view.allocation.sector.map(slice),
      region: view.allocation.region.map(slice),
      currency: view.allocation.currency.map(slice),
    },
  };
}
