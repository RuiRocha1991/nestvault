import { dec, div, mul, sub, sum, type Dec, type DecInput, type Money } from './decimal';
import { fx, toEur, type FxRates } from './fx';

export type InvestmentOpType = 'buy' | 'sell' | 'div';

export interface InvestmentAsset {
  id: string;
  currency: string;
  /** Current price in the asset's currency. */
  price: string;
  /** Price history, any order; used when `asOf` is before `today`. */
  prices?: readonly { date: string; price: string }[];
  /** Annual dividend per share in the asset's currency. */
  dps?: string | null;
  /** Calendar months (1-12) in which the dividend is paid; the annual dps is split evenly. */
  divMonths?: readonly number[] | null;
}

/** One investment operation. Quantities, prices and amounts are decimal strings; fees are in EUR. */
export interface InvestmentOp {
  id: string;
  date: string;
  assetId: string;
  type: InvestmentOpType;
  portfolioId?: string | null;
  /** Cash account the operation settles in; `null` means no account. */
  accountId?: string | null;
  subAccountId?: string | null;
  /** A buy paid from the portfolio's own cash (counts in portfolio cash for untracked accounts). */
  fromCash?: boolean;
  qty?: DecInput | null;
  price?: DecInput | null;
  fee?: DecInput | null;
  /** Net dividend received, in the asset's currency. */
  amount?: DecInput | null;
  /** Gross dividend and withholding tax, when known. */
  gross?: DecInput | null;
  tax?: DecInput | null;
}

/** `accountId: null` selects operations without an account; omit it to select all. */
export interface HoldingsOptions {
  asOf: string;
  /** Current date: from it on the asset's current price is used, before it the price history. */
  today: string;
  portfolioIds?: readonly string[] | null;
  accountId?: string | null;
  /** Narrows `accountId` to one sub-account; omit it to include every sub-account. */
  subAccountId?: string | null;
  /** `asset` merges accounts (prototype default); `position` keeps asset + account + sub-account. */
  groupBy?: 'asset' | 'position';
}

/** Quantities at or below this count as a closed position. */
export const CLOSED_QTY = dec('1e-9');

export interface Holding {
  key: string;
  assetId: string;
  accountId: string | null;
  subAccountId: string | null;
  currency: string;
  qty: Dec;
  price: Dec;
  /** Native-currency (asset currency) figures. */
  costN: Dec;
  realizedN: Dec;
  divsN: Dec;
  valueN: Dec;
  gainN: Dec;
  totalN: Dec;
  incomeN: Dec;
  incomeNetN: Dec;
  /** Withholding rate Σtax / Σgross, 0 when unknown. */
  wht: Dec;
  /** Average price per unit, native. */
  avg: Dec;
  /** EUR figures at the given FX. */
  value: Money;
  cost: Money;
  realized: Money;
  divs: Money;
  gain: Money;
  gainPct: Dec;
  total: Money;
  income: Money;
  /** Payment months of the asset's dividend (empty when unknown). */
  divMonths: readonly number[];
  /** Share of the total value of open positions; 0 for closed ones. */
  weight: Dec;
  isOpen: boolean;
}

export interface SaleGain {
  cost: Money;
  proceeds: Money;
  gain: Money;
  proceedsN: Dec;
  gainN: Dec;
}

const NO_ACCOUNT = '__none';

/** Treats missing and empty values as zero, like the prototype's `+x || 0`. */
function num(value: DecInput | null | undefined): Dec {
  return value === null || value === undefined || value === '' ? dec(0) : dec(value);
}

/** Running quantity and average-cost basis of one position, in one currency. */
interface CostBook {
  qty: Dec;
  cost: Dec;
}

/**
 * Removes up to `qty` units at average cost and returns what was sold and the cost removed. A
 * sell larger than the held quantity is capped; closing the position removes the cost exactly,
 * avoiding division residue.
 */
function sellAtAverage(book: CostBook, qty: Dec): { sold: Dec; removed: Dec } {
  const sold = qty.lt(book.qty) ? qty : book.qty;
  const removed = sold.gte(book.qty) ? book.cost : book.cost.times(sold).div(book.qty);
  book.cost = book.cost.minus(removed);
  book.qty = book.qty.minus(sold);
  return { sold, removed };
}

/** Position key of an operation: asset + account + sub-account. */
export function positionKey(op: InvestmentOp): string {
  const account = op.accountId || NO_ACCOUNT;
  return [op.assetId, account, op.accountId ? (op.subAccountId ?? '') : ''].join('|');
}

/** ISO dates sort as strings; works for any dated record. */
export function byDate(a: { date: string }, b: { date: string }): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
}

/** Date order, buys before sells on the same date (stable otherwise). */
function byDateBuysFirst(a: InvestmentOp, b: InvestmentOp): number {
  return byDate(a, b) || Number(a.type === 'sell') - Number(b.type === 'sell');
}

export function indexAssets(assets: readonly InvestmentAsset[]): Map<string, InvestmentAsset> {
  return new Map(assets.map((asset) => [asset.id, asset]));
}

/** Latest history price on or before `asOf`; the current price from `today` on or without history. */
export function priceAt(asset: InvestmentAsset, asOf: string, today: string): Dec {
  const current = num(asset.price);
  if (asOf >= today || !asset.prices?.length) return current;
  let found: { date: string; price: string } | undefined;
  for (const entry of asset.prices) {
    if (entry.date <= asOf && (!found || entry.date >= found.date)) found = entry;
  }
  return found ? num(found.price) : current;
}

/** Cash effect of an operation in EUR: buys out, sells and dividends in. Fees are already EUR. */
export function cashEffect(op: InvestmentOp, asset: InvestmentAsset | undefined, rates: FxRates) {
  const currency = asset?.currency;
  if (op.type === 'div') return toEur(num(op.amount), currency, rates);
  const gross = toEur(mul(num(op.qty), num(op.price)), currency, rates);
  return op.type === 'buy' ? gross.plus(num(op.fee)).neg() : gross.minus(num(op.fee));
}

/** Cash effect in the asset's own currency (the fee converted from EUR). */
export function cashEffectNative(
  op: InvestmentOp,
  asset: InvestmentAsset | undefined,
  rates: FxRates,
) {
  const feeN = num(op.fee).div(fx(asset?.currency, rates));
  const gross = mul(num(op.qty), num(op.price));
  if (op.type === 'buy') return gross.plus(feeN).neg();
  if (op.type === 'sell') return gross.minus(feeN);
  return num(op.amount);
}

export type ScopeOptions = Pick<HoldingsOptions, 'portfolioIds' | 'accountId' | 'subAccountId'>;

/** Empty or missing `portfolioIds` means every portfolio. */
export function inPortfolios(
  portfolioIds: readonly string[] | null | undefined,
  portfolioId: string | null | undefined,
): boolean {
  return !portfolioIds?.length || portfolioIds.includes(portfolioId ?? '');
}

/** Portfolio / account / sub-account filter of the options (the date is checked by callers). */
export function isInScope(op: InvestmentOp, options: ScopeOptions): boolean {
  const { portfolioIds, accountId, subAccountId } = options;
  if (!inPortfolios(portfolioIds, op.portfolioId)) return false;
  if (accountId === undefined) return true;
  if (accountId === null) return !op.accountId;
  if (op.accountId !== accountId) return false;
  return subAccountId == null || (op.subAccountId ?? null) === subAccountId;
}

interface Accumulator extends CostBook {
  asset: InvestmentAsset;
  accountId: string | null;
  subAccountId: string | null;
  realizedN: Dec;
  divsN: Dec;
  gross: Dec;
  tax: Dec;
}

/**
 * Average-cost positions in the asset's currency, converted to EUR with the given FX. Operations
 * on assets that are not in `assets` are ignored. A sell larger than the held quantity is capped
 * at the held quantity.
 */
export function computeHoldings(
  ops: readonly InvestmentOp[],
  assets: readonly InvestmentAsset[],
  rates: FxRates,
  options: HoldingsOptions,
): Holding[] {
  const byId = indexAssets(assets);
  const byPosition = options.groupBy === 'position';
  const groups = new Map<string, Accumulator>();
  const scoped = ops
    .filter((op) => op.date <= options.asOf && byId.has(op.assetId) && isInScope(op, options))
    .sort(byDateBuysFirst);

  for (const op of scoped) {
    const asset = byId.get(op.assetId);
    if (!asset) continue;
    const key = byPosition ? positionKey(op) : op.assetId;
    let h = groups.get(key);
    if (!h) {
      h = {
        asset,
        accountId: byPosition ? (op.accountId ?? null) : null,
        subAccountId: byPosition && op.accountId ? (op.subAccountId ?? null) : null,
        qty: dec(0),
        cost: dec(0),
        realizedN: dec(0),
        divsN: dec(0),
        gross: dec(0),
        tax: dec(0),
      };
      groups.set(key, h);
    }
    if (op.type === 'div') {
      h.divsN = h.divsN.plus(num(op.amount));
      const gross = num(op.gross);
      const tax = num(op.tax);
      if (gross.gt(0) && tax.gt(0)) {
        h.gross = h.gross.plus(gross);
        h.tax = h.tax.plus(tax);
      }
      continue;
    }
    const qty = num(op.qty);
    const feeN = num(op.fee).div(fx(asset.currency, rates));
    if (op.type === 'buy') {
      h.qty = h.qty.plus(qty);
      h.cost = h.cost.plus(mul(qty, num(op.price))).plus(feeN);
    } else {
      const { sold, removed } = sellAtAverage(h, qty);
      h.realizedN = h.realizedN
        .plus(mul(sold, num(op.price)))
        .minus(feeN)
        .minus(removed);
    }
  }

  const holdings = [...groups.entries()].flatMap(([key, h]): Holding[] => {
    const isOpen = h.qty.gt(CLOSED_QTY);
    if (!isOpen && h.realizedN.isZero() && h.divsN.isZero()) return [];
    const rate = fx(h.asset.currency, rates);
    const price = priceAt(h.asset, options.asOf, options.today);
    const wht = h.gross.isZero() ? dec(0) : h.tax.div(h.gross);
    const valueN = h.qty.times(price);
    const incomeN = h.qty.times(num(h.asset.dps));
    const gainN = valueN.minus(h.cost);
    const totalN = gainN.plus(h.realizedN).plus(h.divsN);
    const value = valueN.times(rate);
    const cost = h.cost.times(rate);
    const gain = value.minus(cost);
    return [
      {
        key,
        assetId: h.asset.id,
        accountId: h.accountId,
        subAccountId: h.subAccountId,
        currency: h.asset.currency,
        qty: h.qty,
        price,
        costN: h.cost,
        realizedN: h.realizedN,
        divsN: h.divsN,
        valueN,
        gainN,
        totalN,
        incomeN,
        incomeNetN: incomeN.times(dec(1).minus(wht)),
        wht,
        avg: h.qty.isZero() ? dec(0) : h.cost.div(h.qty),
        value,
        cost,
        realized: h.realizedN.times(rate),
        divs: h.divsN.times(rate),
        gain,
        gainPct: cost.isZero() ? dec(0) : gain.div(cost),
        total: totalN.times(rate),
        income: incomeN.times(rate),
        divMonths: h.asset.divMonths ?? [],
        weight: dec(0),
        isOpen,
      },
    ];
  });

  const totalValue = sum(holdings.filter((h) => h.isOpen).map((h) => h.value));
  const denominator = totalValue.isZero() ? dec(1) : totalValue;
  return holdings.map((h) => (h.isOpen ? { ...h, weight: div(h.value, denominator) } : h));
}

/**
 * Realized gain of every sell in EUR (and native), with the average cost kept per
 * asset + account + sub-account at the current FX. Result is keyed by operation id.
 */
export function realizedGainsPerSale(
  ops: readonly InvestmentOp[],
  assets: readonly InvestmentAsset[],
  rates: FxRates,
): Record<string, SaleGain> {
  const byId = indexAssets(assets);
  const books = new Map<string, CostBook>();
  const gains: Record<string, SaleGain> = {};
  for (const op of [...ops].sort(byDateBuysFirst)) {
    if (op.type === 'div' || !byId.has(op.assetId)) continue;
    const key = positionKey(op);
    let book = books.get(key);
    if (!book) {
      book = { qty: dec(0), cost: dec(0) };
      books.set(key, book);
    }
    const rate = fx(byId.get(op.assetId)?.currency, rates);
    const qty = num(op.qty);
    if (op.type === 'buy') {
      book.qty = book.qty.plus(qty);
      book.cost = book.cost.plus(qty.times(num(op.price)).times(rate)).plus(num(op.fee));
      continue;
    }
    // Proceeds cover only the units actually held, like the holdings' realized gain.
    const { sold, removed: cost } = sellAtAverage(book, qty);
    const proceeds = sold.times(num(op.price)).times(rate).minus(num(op.fee));
    const gain = sub(proceeds, cost);
    gains[op.id] = { cost, proceeds, gain, proceedsN: proceeds.div(rate), gainN: gain.div(rate) };
  }
  return gains;
}
