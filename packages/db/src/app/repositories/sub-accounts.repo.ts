import { and, asc, eq } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import { subAccounts, type SubAccountRow } from '../schema/accounts';

import { investmentOpsRepo } from './investment-ops.repo';
import { plansRepo } from './plans.repo';

export type { SubAccountRow };

export interface SubAccountValues {
  name: string;
  holderId: string | null;
}

/** Brokerage sub-accounts. Every function filters by `ctx.poolId` (and RLS repeats it). */
export const subAccountsRepo = {
  /** Every sub-account of the pool, oldest first (the lists group them by account). */
  async list(tx: PoolTx, ctx: PoolContext): Promise<SubAccountRow[]> {
    return tx
      .select()
      .from(subAccounts)
      .where(eq(subAccounts.poolId, ctx.poolId))
      .orderBy(asc(subAccounts.createdAt), asc(subAccounts.id));
  },

  async find(
    tx: PoolTx,
    ctx: PoolContext,
    accountId: string,
    id: string,
  ): Promise<SubAccountRow | undefined> {
    const [row] = await tx
      .select()
      .from(subAccounts)
      .where(
        and(
          eq(subAccounts.poolId, ctx.poolId),
          eq(subAccounts.accountId, accountId),
          eq(subAccounts.id, id),
        ),
      );
    return row;
  },

  async insert(
    tx: PoolTx,
    ctx: PoolContext,
    accountId: string,
    id: string,
    data: SubAccountValues,
  ): Promise<SubAccountRow> {
    const [row] = await tx
      .insert(subAccounts)
      .values({ id, poolId: ctx.poolId, accountId, name: data.name, holderId: data.holderId })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  async update(
    tx: PoolTx,
    ctx: PoolContext,
    accountId: string,
    id: string,
    data: SubAccountValues,
  ): Promise<SubAccountRow | undefined> {
    const [row] = await tx
      .update(subAccounts)
      .set({ name: data.name, holderId: data.holderId })
      .where(
        and(
          eq(subAccounts.poolId, ctx.poolId),
          eq(subAccounts.accountId, accountId),
          eq(subAccounts.id, id),
        ),
      )
      .returning();
    return row;
  },

  async remove(tx: PoolTx, ctx: PoolContext, accountId: string, id: string): Promise<boolean> {
    const rows = await tx
      .delete(subAccounts)
      .where(
        and(
          eq(subAccounts.poolId, ctx.poolId),
          eq(subAccounts.accountId, accountId),
          eq(subAccounts.id, id),
        ),
      )
      .returning({ id: subAccounts.id });
    return rows.length > 0;
  },

  /** How many investment operations and plans use this sub-account. */
  async countReferences(tx: PoolTx, ctx: PoolContext, id: string): Promise<number> {
    const [ops, planCount] = await Promise.all([
      investmentOpsRepo.countBySubAccount(tx, ctx, id),
      plansRepo.countBySubAccount(tx, ctx, id),
    ]);
    return ops + planCount;
  },
};
