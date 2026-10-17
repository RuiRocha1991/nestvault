import { addMonths, monthKey } from './dates';
import { dec, sum, type Dec, type Money } from './decimal';
import { addTo, type ByCurrency, type FxRates } from './fx';
import {
  cashEffect,
  indexAssets,
  isInScope,
  type Holding,
  type InvestmentAsset,
  type InvestmentOp,
  type ScopeOptions,
} from './positions';

export interface ForecastItem {
  assetId: string;
  /** EUR expected in the month. */
  value: Money;
}

export interface ForecastMonth {
  /** `yyyy-mm`. */
  month: string;
  items: ForecastItem[];
  value: Money;
}

/**
 * Expected dividends per month for the open positions that have a dividend per share and payment
 * months: each payment month gets the annual income divided evenly. `months` are `yyyy-mm` keys.
 */
export function dividendsForecast(
  holdings: readonly Holding[],
  months: readonly string[],
): ForecastMonth[] {
  const payers = holdings.filter((h) => h.isOpen && h.incomeN.gt(0) && h.divMonths.length > 0);
  return months.map((month) => {
    const monthNumber = Number(month.slice(5));
    const items = payers
      .filter((h) => h.divMonths.includes(monthNumber))
      .map((h) => ({ assetId: h.assetId, value: h.income.div(h.divMonths.length) }));
    return { month, items, value: sum(items.map((item) => item.value)) };
  });
}

/** Dividend operations of known assets inside the scope, like the positions count them. */
function dividendOps(
  ops: readonly InvestmentOp[],
  byId: ReadonlyMap<string, InvestmentAsset>,
  scope: ScopeOptions,
) {
  return ops.filter((op) => op.type === 'div' && byId.has(op.assetId) && isInScope(op, scope));
}

/** EUR received per month, in the order of `months` (`yyyy-mm` keys). */
export function dividendsReceived(
  ops: readonly InvestmentOp[],
  assets: readonly InvestmentAsset[],
  rates: FxRates,
  months: readonly string[],
  scope: ScopeOptions = {},
): Money[] {
  const byId = indexAssets(assets);
  const perMonth = new Map<string, Dec>();
  for (const op of dividendOps(ops, byId, scope)) {
    const key = monthKey(op.date);
    perMonth.set(
      key,
      (perMonth.get(key) ?? dec(0)).plus(cashEffect(op, byId.get(op.assetId), rates)),
    );
  }
  return months.map((month) => perMonth.get(month) ?? dec(0));
}

export interface DividendsLast12Months {
  /** Total in EUR. */
  eur: Money;
  /** Net amounts by asset currency. */
  byCurrency: ByCurrency;
}

/** Dividends received after `asOf` minus 12 months, up to and including `asOf`. */
export function dividendsLast12Months(
  ops: readonly InvestmentOp[],
  assets: readonly InvestmentAsset[],
  rates: FxRates,
  asOf: string,
  scope: ScopeOptions = {},
): DividendsLast12Months {
  const since = addMonths(asOf, -12);
  const byId = indexAssets(assets);
  const recent = dividendOps(ops, byId, scope).filter((op) => op.date > since && op.date <= asOf);
  const byCurrency: ByCurrency = {};
  for (const op of recent) {
    const currency = byId.get(op.assetId)?.currency ?? 'EUR';
    addTo(byCurrency, currency, op.amount ?? 0);
  }
  return {
    eur: sum(recent.map((op) => cashEffect(op, byId.get(op.assetId), rates))),
    byCurrency,
  };
}
