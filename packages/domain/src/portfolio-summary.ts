import { dec, sum, type Dec, type DecInput, type Money } from './decimal';
import { dividendsLast12Months } from './dividends';
import { addTo, sumToEur, type ByCurrency, type FxRates } from './fx';
import { portfolioCash, type CashAccount, type PortfolioCashMove } from './portfolio-cash';
import {
  cashEffect,
  computeHoldings,
  indexAssets,
  inPortfolios,
  isInScope,
  type Holding,
  type HoldingsOptions,
  type InvestmentAsset,
  type InvestmentOp,
} from './positions';
import { xirr } from './xirr';

/**
 * An account as the summary needs it, with its balance and interest already computed (the
 * account and deposit engines own those numbers). Amounts are in the account's currency; a term
 * deposit is passed as EUR.
 */
export interface SummaryAccount extends CashAccount {
  currency: string;
  /** Brokerage accounts count as portfolio cash when their operations belong to the portfolio. */
  isBrokerage: boolean;
  /** Portfolio the account is linked to (e.g. an emergency fund), if any. */
  portfolioId?: string | null;
  balance: DecInput;
  /** Interest earned (or the net value of a term deposit), counted in the profit. */
  interest: DecInput;
}

export interface PortfolioSummaryInput {
  ops: readonly InvestmentOp[];
  assets: readonly InvestmentAsset[];
  accounts: readonly SummaryAccount[];
  moves: readonly PortfolioCashMove[];
  rates: FxRates;
}

export interface PortfolioSummary {
  /** Per-currency maps. `value`, `cost`, `gain` and `income` cover open positions only. */
  valueBy: ByCurrency;
  costBy: ByCurrency;
  gainBy: ByCurrency;
  totalBy: ByCurrency;
  divsBy: ByCurrency;
  realizedBy: ByCurrency;
  incomeBy: ByCurrency;
  incomeNetBy: ByCurrency;
  divs12By: ByCurrency;
  divGrossBy: ByCurrency;
  /** Withholding taxes, negative. */
  taxBy: ByCurrency;
  /** Tax refunds, positive. */
  refundBy: ByCurrency;
  cashBy: ByCurrency;
  /** Interest of brokerage and linked accounts, and the net value of linked term deposits. */
  otherBy: ByCurrency;
  profitBy: ByCurrency;
  valueAllBy: ByCurrency;
  /** EUR totals. */
  valueAll: Money;
  profit: Money;
  netInvested: Money;
  /** `profit / netInvested`, 0 when `netInvested` is not above 0.5. */
  profitPct: Dec;
  /** Portfolio cash in EUR (0 when filtered to one account). */
  cash: Money;
  holdings: Holding[];
  open: Holding[];
  value: Money;
  cost: Money;
  gain: Money;
  gainPct: Dec;
  realized: Money;
  divs: Money;
  total: Money;
  totalPct: Dec;
  income: Money;
  yld: Dec;
  yoc: Dec;
  /** Annualised return of the operations plus the current value; `NaN` when undefined. */
  irr: number;
  divs12: Money;
  positions: number;
}

const MIN_NET_INVESTED = dec('0.5');

function ratio(numerator: Dec, denominator: Dec): Dec {
  return denominator.isZero() ? dec(0) : numerator.div(denominator);
}

function groupBy(items: readonly Holding[], pick: (h: Holding) => Dec): ByCurrency {
  const map: ByCurrency = {};
  for (const h of items) addTo(map, h.currency, pick(h));
  return map;
}

function mergeInto(target: ByCurrency, source: Readonly<ByCurrency>): void {
  for (const [currency, amount] of Object.entries(source)) addTo(target, currency, amount);
}

/**
 * Snowball-style total return of a scope (portfolios, or one account / sub-account): unrealized
 * gain of open positions + gross dividends − withholding + tax refunds + realized sales + other
 * (interest of brokerage and linked accounts, deposit net value). Linked accounts and portfolio
 * cash only count when the scope is not narrowed to one account.
 */
export function portfolioSummary(
  data: PortfolioSummaryInput,
  options: HoldingsOptions,
): PortfolioSummary {
  const { ops, assets, accounts, moves, rates } = data;
  const holdings = computeHoldings(ops, assets, rates, options);
  const open = holdings.filter((h) => h.isOpen);
  const value = sum(open.map((h) => h.value));
  const cost = sum(open.map((h) => h.cost));
  const realized = sum(holdings.map((h) => h.realized));
  const divs = sum(holdings.map((h) => h.divs));
  const income = sum(open.map((h) => h.income));
  const byAsset = indexAssets(assets);

  const scoped = ops.filter(
    (op) => op.date <= options.asOf && byAsset.has(op.assetId) && isInScope(op, options),
  );
  const flows = scoped.map((op) => ({
    date: op.date,
    amount: cashEffect(op, byAsset.get(op.assetId), rates),
  }));
  if (value.gt(0)) flows.push({ date: options.asOf, amount: value });
  const irr = xirr(flows);

  const divs12 = dividendsLast12Months(ops, assets, rates, options.asOf, options);

  const divGrossBy: ByCurrency = {};
  const taxBy: ByCurrency = {};
  const refundBy: ByCurrency = {};
  for (const op of scoped.filter((o) => o.type === 'div')) {
    const currency = byAsset.get(op.assetId)?.currency ?? 'EUR';
    const tax = dec(op.tax ?? 0);
    addTo(divGrossBy, currency, op.gross != null ? op.gross : (op.amount ?? 0));
    if (tax.gt(0)) addTo(taxBy, currency, tax.neg());
    else if (tax.lt(0)) addTo(refundBy, currency, tax.neg());
  }

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const narrowed = options.accountId !== undefined;

  // Brokerage accounts whose operations all belong to this scope contribute their cash balance.
  const sharedWithOtherScopes = new Set<string>();
  if (options.accountId == null) {
    for (const op of ops) {
      if (
        op.date <= options.asOf &&
        op.accountId &&
        !inPortfolios(options.portfolioIds, op.portfolioId)
      ) {
        sharedWithOtherScopes.add(op.accountId);
      }
    }
  }
  const counted = new Set<string>();
  const cashBy: ByCurrency = {};
  const otherBy: ByCurrency = {};
  const countAccount = (account: SummaryAccount) => {
    counted.add(account.id);
    addTo(cashBy, account.currency, account.balance);
    addTo(otherBy, account.currency, account.interest);
  };
  for (const op of scoped) {
    const account = op.accountId ? accountById.get(op.accountId) : undefined;
    if (account?.trackCash && account.isBrokerage && !counted.has(account.id)) {
      if (!sharedWithOtherScopes.has(account.id)) countAccount(account);
    }
  }

  let cash = dec(0);
  if (!narrowed) {
    cash = portfolioCash(ops, moves, accounts, assets, rates, options);
    addTo(cashBy, 'EUR', cash);
    for (const account of accounts) {
      const linked =
        !!account.portfolioId && inPortfolios(options.portfolioIds, account.portfolioId);
      if (linked && !counted.has(account.id)) countAccount(account);
    }
  }

  const gainBy = groupBy(open, (h) => h.gainN);
  const realizedBy = groupBy(holdings, (h) => h.realizedN);
  const profitBy: ByCurrency = {};
  for (const part of [gainBy, divGrossBy, taxBy, refundBy, realizedBy, otherBy]) {
    mergeInto(profitBy, part);
  }
  const valueBy = groupBy(open, (h) => h.valueN);
  const valueAllBy: ByCurrency = { ...valueBy };
  mergeInto(valueAllBy, cashBy);

  const valueAll = sumToEur(valueAllBy, rates);
  const profit = sumToEur(profitBy, rates);
  const netInvested = valueAll.minus(profit);
  const gain = value.minus(cost);
  const total = gain.plus(realized).plus(divs);

  return {
    valueBy,
    costBy: groupBy(open, (h) => h.costN),
    gainBy,
    totalBy: groupBy(holdings, (h) => h.totalN),
    divsBy: groupBy(holdings, (h) => h.divsN),
    realizedBy,
    incomeBy: groupBy(open, (h) => h.incomeN),
    incomeNetBy: groupBy(open, (h) => h.incomeNetN),
    divs12By: divs12.byCurrency,
    divGrossBy,
    taxBy,
    refundBy,
    cashBy,
    otherBy,
    profitBy,
    valueAllBy,
    valueAll,
    profit,
    netInvested,
    profitPct: netInvested.gt(MIN_NET_INVESTED) ? profit.div(netInvested) : dec(0),
    cash,
    holdings,
    open,
    value,
    cost,
    gain,
    gainPct: ratio(gain, cost),
    realized,
    divs,
    total,
    totalPct: ratio(total, cost),
    income,
    yld: ratio(income, value),
    yoc: ratio(income, cost),
    irr,
    divs12: divs12.eur,
    positions: open.length,
  };
}
