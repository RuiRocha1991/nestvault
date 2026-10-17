import { sum, type DecInput, type Money } from './decimal';
import type { FxRates } from './fx';
import {
  cashEffect,
  indexAssets,
  inPortfolios,
  isInScope,
  type InvestmentAsset,
  type InvestmentOp,
} from './positions';

/** The part of an account the portfolio cash needs. A missing account counts as untracked. */
export interface CashAccount {
  id: string;
  /** `false` when the account balance does not follow its operations (e.g. PPR by direct debit). */
  trackCash: boolean;
}

/** A manual move of cash into (+) or out of (−) a portfolio, in EUR. */
export interface PortfolioCashMove {
  portfolioId: string;
  date: string;
  amount: DecInput;
}

export interface PortfolioCashOptions {
  asOf: string;
  portfolioIds?: readonly string[] | null;
}

/** Buys only touch portfolio cash when flagged `fromCash`; sells and dividends always do. */
function touchesCash(op: InvestmentOp): boolean {
  return op.type !== 'buy' || op.fromCash === true;
}

/**
 * Cash that stays in the portfolio, in EUR: sells, dividends and buys flagged `fromCash` whose
 * account does not track cash (or that have no account), plus the manual moves. Buys that are not
 * flagged never create negative cash.
 */
export function portfolioCash(
  ops: readonly InvestmentOp[],
  moves: readonly PortfolioCashMove[],
  accounts: readonly CashAccount[],
  assets: readonly InvestmentAsset[],
  rates: FxRates,
  options: PortfolioCashOptions,
): Money {
  const tracked = new Set<string>();
  for (const account of accounts) if (account.trackCash) tracked.add(account.id);
  const byId = indexAssets(assets);
  const scope = { portfolioIds: options.portfolioIds ?? null };

  const fromOps = ops
    .filter(
      (op) =>
        byId.has(op.assetId) &&
        isInScope(op, scope) &&
        op.date <= options.asOf &&
        !(op.accountId && tracked.has(op.accountId)) &&
        touchesCash(op),
    )
    .map((op) => cashEffect(op, byId.get(op.assetId), rates));
  const fromMoves = moves
    .filter(
      (move) => inPortfolios(options.portfolioIds, move.portfolioId) && move.date <= options.asOf,
    )
    .map((move) => move.amount);
  return sum(fromOps).plus(sum(fromMoves));
}
