import { accountsRepo, type PoolContext, type PoolTx } from '@nestvault/db';

import { invalid } from '../investments/checks';

/** The payment period and the term each come as a number with its unit, or not at all. */
export function assertPeriods(values: {
  payN: number | null;
  payU: string | null;
  termN: number | null;
  termU: string | null;
}): void {
  if ((values.payN === null) !== (values.payU === null)) {
    throw invalid('payN', 'the payment period needs both its number and its unit');
  }
  if ((values.termN === null) !== (values.termU === null)) {
    throw invalid('termN', 'the term needs both its number and its unit');
  }
}

/** Where the interest goes and where the money comes from: an account of the pool, not a deposit. */
export async function assertFundingAccount(
  tx: PoolTx,
  ctx: PoolContext,
  accountId: string | null,
  path: string,
): Promise<void> {
  if (accountId === null) return;
  const account = await accountsRepo.find(tx, ctx, accountId);
  if (!account) throw invalid(path, 'not an account of this pool');
  if (account.type === 'term_deposit') throw invalid(path, 'cannot be a term-deposit account');
}

/** Ids come lower-cased from the database; the request may use any case. */
export const lowerOrNull = (id: string | null | undefined): string | null =>
  id ? id.toLowerCase() : null;
