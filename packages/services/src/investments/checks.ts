import {
  accountsRepo,
  assetsRepo,
  isUuid,
  portfoliosRepo,
  subAccountsRepo,
  type InvestmentOpValues,
  type PoolContext,
  type PoolTx,
} from '@nestvault/db';
import { dec } from '@nestvault/domain';

import { isForeignKeyViolation, violatedConstraint } from '../db-errors';
import { NotFoundError, ValidationError } from '../errors';

export const invalid = (path: string, message: string) =>
  new ValidationError('The request is not valid.', [{ path, message }]);

/** Accounts an investment can settle in. */
export const CASH_ACCOUNT_TYPES: ReadonlySet<string> = new Set(['brokerage', 'checking']);

/** The portfolio and the asset must be the pool's own. */
export async function assertPortfolioAndAsset(
  tx: PoolTx,
  ctx: PoolContext,
  portfolioId: string,
  assetId: string,
): Promise<void> {
  if (!(await portfoliosRepo.find(tx, ctx, portfolioId))) {
    throw invalid('portfolioId', 'not a portfolio of this pool');
  }
  if (!(await assetsRepo.find(tx, ctx, assetId))) {
    throw invalid('assetId', 'not an asset of this pool');
  }
}

/**
 * The account must be a brokerage or checking account of the pool, and the sub-account one of that
 * account. (The database repeats the second rule with a composite foreign key.)
 */
export async function assertPlacement(
  tx: PoolTx,
  ctx: PoolContext,
  accountId: string | null,
  subAccountId: string | null,
): Promise<void> {
  if (subAccountId && !accountId) {
    throw invalid('subAccountId', 'a sub-account needs its account');
  }
  if (!accountId) return;
  const account = await accountsRepo.find(tx, ctx, accountId);
  if (!account) throw invalid('accountId', 'not an account of this pool');
  if (!CASH_ACCOUNT_TYPES.has(account.type)) {
    throw invalid('accountId', 'must be a brokerage or checking account');
  }
  if (subAccountId && !(await subAccountsRepo.find(tx, ctx, accountId, subAccountId))) {
    throw invalid('subAccountId', 'not a sub-account of this account');
  }
}

/**
 * Rules per type: a buy or a sell needs a quantity above zero and a price of zero or more; a
 * dividend needs its net amount. Fields that do not belong to the type are cleared, so a row never
 * carries a quantity on a dividend or an amount on a buy.
 */
export function normalizeOp(values: InvestmentOpValues): InvestmentOpValues {
  if (values.type === 'dividend') {
    if (values.amount === null) throw invalid('amount', 'a dividend needs its amount');
    return { ...values, qty: null, price: null, fee: null, fromCash: false };
  }
  if (values.qty === null || !dec(values.qty).gt(0)) {
    throw invalid('qty', 'must be above zero');
  }
  if (values.price === null) throw invalid('price', 'a trade needs its price');
  return { ...values, amount: null, gross: null, tax: null };
}

/** A path id: anything that is not a UUID is a 404, and ids are compared in lower case. */
export function parseId(id: string): string {
  if (!isUuid(id)) throw new NotFoundError();
  return id.toLowerCase();
}

/**
 * The account and sub-account after a patch. Fields left out stay, except that clearing the account
 * or moving to another one clears the sub-account (it belonged to the old account).
 */
export function resolvePlacement(
  base: { accountId: string | null; subAccountId: string | null },
  patch: { accountId?: string | null | undefined; subAccountId?: string | null | undefined },
): { accountId: string | null; subAccountId: string | null } {
  const accountId =
    patch.accountId === undefined ? base.accountId : (patch.accountId?.toLowerCase() ?? null);
  const subAccountId =
    patch.subAccountId !== undefined
      ? (patch.subAccountId?.toLowerCase() ?? null)
      : accountId === base.accountId
        ? base.subAccountId
        : null;
  return { accountId, subAccountId };
}

/** The request field a foreign key is about, from the constraint's name (`plans_asset_fk`, …). */
function fieldOf(constraint: string | undefined): string {
  if (constraint?.includes('sub_account')) return 'subAccountId';
  if (constraint?.includes('account')) return 'accountId';
  if (constraint?.includes('asset')) return 'assetId';
  if (constraint?.includes('portfolio')) return 'portfolioId';
  return 'reference';
}

/** A reference that slipped past the checks (a race) is still a client error, not a 500. */
export function refOrRethrow(error: unknown): never {
  if (isForeignKeyViolation(error)) {
    throw invalid(fieldOf(violatedConstraint(error)), 'a reference is not valid');
  }
  throw error;
}
