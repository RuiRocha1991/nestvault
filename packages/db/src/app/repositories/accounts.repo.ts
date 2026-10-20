import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import { accountHolders, accounts, type AccountRow } from '../schema/accounts';
import { transactions } from '../schema/transactions';

import { depositsRepo } from './deposits.repo';
import { interestEntriesRepo } from './interest-entries.repo';
import { investmentOpsRepo } from './investment-ops.repo';
import { plansRepo } from './plans.repo';
import { portfolioCashMovesRepo } from './portfolio-cash-moves.repo';
import { savingsProductsRepo } from './savings-products.repo';

export type { AccountRow };

export interface AccountValues {
  type: string;
  name: string;
  institution: string | null;
  iban: string | null;
  currency: string;
  opening: string;
  openingDate: string | null;
  trackCash: boolean;
  groupName: string | null;
  portfolioId: string | null;
  rate: string | null;
  xtbAccountNo: string | null;
}

export interface AccountHolderLink {
  accountId: string;
  holderId: string;
}

/**
 * Accounts and the people who own them. Every function filters by `ctx.poolId` (and RLS repeats it);
 * the pool of a row never comes from the caller's data.
 */
export const accountsRepo = {
  async list(tx: PoolTx, ctx: PoolContext): Promise<AccountRow[]> {
    return tx
      .select()
      .from(accounts)
      .where(eq(accounts.poolId, ctx.poolId))
      .orderBy(asc(accounts.createdAt), asc(accounts.id));
  },

  async find(tx: PoolTx, ctx: PoolContext, id: string): Promise<AccountRow | undefined> {
    const [row] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.poolId, ctx.poolId), eq(accounts.id, id)));
    return row;
  },

  async insert(tx: PoolTx, ctx: PoolContext, id: string, data: AccountValues): Promise<AccountRow> {
    const [row] = await tx
      .insert(accounts)
      .values({
        id,
        poolId: ctx.poolId,
        type: data.type,
        name: data.name,
        institution: data.institution,
        iban: data.iban,
        currency: data.currency,
        opening: data.opening,
        openingDate: data.openingDate,
        trackCash: data.trackCash,
        groupName: data.groupName,
        portfolioId: data.portfolioId,
        rate: data.rate,
        xtbAccountNo: data.xtbAccountNo,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  /** Replaces the editable fields. Returns `undefined` when the account is not in this pool. */
  async update(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: AccountValues,
  ): Promise<AccountRow | undefined> {
    const [row] = await tx
      .update(accounts)
      .set({
        type: data.type,
        name: data.name,
        institution: data.institution,
        iban: data.iban,
        currency: data.currency,
        opening: data.opening,
        openingDate: data.openingDate,
        trackCash: data.trackCash,
        groupName: data.groupName,
        portfolioId: data.portfolioId,
        rate: data.rate,
        xtbAccountNo: data.xtbAccountNo,
        updatedAt: new Date(),
      })
      .where(and(eq(accounts.poolId, ctx.poolId), eq(accounts.id, id)))
      .returning();
    return row;
  },

  /** Deletes the account; its holder links and sub-accounts go with it (cascade). */
  async remove(tx: PoolTx, ctx: PoolContext, id: string): Promise<boolean> {
    const rows = await tx
      .delete(accounts)
      .where(and(eq(accounts.poolId, ctx.poolId), eq(accounts.id, id)))
      .returning({ id: accounts.id });
    return rows.length > 0;
  },

  /**
   * How many movements, plans and references are on this account: transactions, investment
   * operations, plans, interest entries, and the products and deposits that name it as where the
   * interest goes or the money comes from, and portfolio cash moves. (Its own deposit goes with it.)
   */
  async countReferences(tx: PoolTx, ctx: PoolContext, id: string): Promise<number> {
    const [movements] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(transactions)
      .where(and(eq(transactions.poolId, ctx.poolId), eq(transactions.accountId, id)));
    const counts = await Promise.all([
      investmentOpsRepo.countByAccount(tx, ctx, id),
      plansRepo.countByAccount(tx, ctx, id),
      interestEntriesRepo.countByAccount(tx, ctx, id),
      savingsProductsRepo.countByAccount(tx, ctx, id),
      depositsRepo.countByFundingAccount(tx, ctx, id),
      portfolioCashMovesRepo.countByAccount(tx, ctx, id),
    ]);
    return counts.reduce((total, n) => total + n, movements?.n ?? 0);
  },

  /** Every holder link of the pool's accounts (or of the given ones). */
  async listHolders(
    tx: PoolTx,
    ctx: PoolContext,
    accountIds?: readonly string[],
  ): Promise<AccountHolderLink[]> {
    if (accountIds?.length === 0) return [];
    return tx
      .select({ accountId: accountHolders.accountId, holderId: accountHolders.holderId })
      .from(accountHolders)
      .where(
        and(
          eq(accountHolders.poolId, ctx.poolId),
          accountIds ? inArray(accountHolders.accountId, [...accountIds]) : undefined,
        ),
      )
      .orderBy(asc(accountHolders.accountId), asc(accountHolders.holderId));
  },

  /** Makes `holderIds` the account's owners: the others are unlinked, the missing ones linked. */
  async setHolders(
    tx: PoolTx,
    ctx: PoolContext,
    accountId: string,
    holderIds: readonly string[],
  ): Promise<void> {
    await tx
      .delete(accountHolders)
      .where(and(eq(accountHolders.poolId, ctx.poolId), eq(accountHolders.accountId, accountId)));
    if (holderIds.length === 0) return;
    await tx
      .insert(accountHolders)
      .values(holderIds.map((holderId) => ({ poolId: ctx.poolId, accountId, holderId })));
  },
};
