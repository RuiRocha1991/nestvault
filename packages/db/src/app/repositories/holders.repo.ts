import { and, asc, count, eq, inArray } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import { accountHolders, subAccounts } from '../schema/accounts';
import { holders, type HolderRow } from '../schema/holders';

export type { HolderRow };

export interface HolderValues {
  name: string;
  color: string;
  aliases: string[];
  userId: string | null;
}

/**
 * People of the household. Every function filters by `ctx.poolId` (and RLS repeats it); the pool of
 * a row never comes from the caller's data.
 */
export const holdersRepo = {
  async list(tx: PoolTx, ctx: PoolContext): Promise<HolderRow[]> {
    return tx
      .select()
      .from(holders)
      .where(eq(holders.poolId, ctx.poolId))
      .orderBy(asc(holders.createdAt), asc(holders.id));
  },

  async find(tx: PoolTx, ctx: PoolContext, id: string): Promise<HolderRow | undefined> {
    const [row] = await tx
      .select()
      .from(holders)
      .where(and(eq(holders.poolId, ctx.poolId), eq(holders.id, id)));
    return row;
  },

  async insert(tx: PoolTx, ctx: PoolContext, id: string, data: HolderValues): Promise<HolderRow> {
    const [row] = await tx
      .insert(holders)
      .values({
        id,
        poolId: ctx.poolId,
        name: data.name,
        color: data.color,
        aliases: data.aliases,
        userId: data.userId,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  /**
   * Adds the holders of members that have none yet. Idempotent: a member that already has a holder
   * (the unique `(pool_id, user_id)`) is skipped, so two requests syncing at once cannot duplicate.
   */
  async insertLinked(
    tx: PoolTx,
    ctx: PoolContext,
    people: readonly (Omit<HolderValues, 'aliases'> & { id: string; userId: string })[],
  ): Promise<void> {
    if (people.length === 0) return;
    await tx
      .insert(holders)
      .values(
        people.map((person) => ({
          id: person.id,
          poolId: ctx.poolId,
          name: person.name,
          color: person.color,
          aliases: [],
          userId: person.userId,
        })),
      )
      .onConflictDoNothing();
  },

  /** Replaces the editable fields. Returns `undefined` when the holder is not in this pool. */
  async update(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: HolderValues,
  ): Promise<HolderRow | undefined> {
    const [row] = await tx
      .update(holders)
      .set({
        name: data.name,
        color: data.color,
        aliases: data.aliases,
        userId: data.userId,
        updatedAt: new Date(),
      })
      .where(and(eq(holders.poolId, ctx.poolId), eq(holders.id, id)))
      .returning();
    return row;
  },

  async remove(tx: PoolTx, ctx: PoolContext, id: string): Promise<boolean> {
    const rows = await tx
      .delete(holders)
      .where(and(eq(holders.poolId, ctx.poolId), eq(holders.id, id)))
      .returning({ id: holders.id });
    return rows.length > 0;
  },

  /** How many accounts own this holder plus how many sub-accounts name them. */
  async countReferences(tx: PoolTx, ctx: PoolContext, id: string): Promise<number> {
    const [owned, named] = await Promise.all([
      tx
        .select({ n: count() })
        .from(accountHolders)
        .where(and(eq(accountHolders.poolId, ctx.poolId), eq(accountHolders.holderId, id))),
      tx
        .select({ n: count() })
        .from(subAccounts)
        .where(and(eq(subAccounts.poolId, ctx.poolId), eq(subAccounts.holderId, id))),
    ]);
    return (owned[0]?.n ?? 0) + (named[0]?.n ?? 0);
  },

  /** Locks the row until the transaction ends, so two merges of the same person queue up. */
  async findForUpdate(tx: PoolTx, ctx: PoolContext, id: string): Promise<HolderRow | undefined> {
    const [row] = await tx
      .select()
      .from(holders)
      .where(and(eq(holders.poolId, ctx.poolId), eq(holders.id, id)))
      .for('update');
    return row;
  },

  /** How many account ownerships and sub-accounts a merge of this holder moves. */
  async countMoves(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
  ): Promise<{ accounts: number; subAccounts: number }> {
    const [owned, named] = await Promise.all([
      tx
        .select({ n: count() })
        .from(accountHolders)
        .where(and(eq(accountHolders.poolId, ctx.poolId), eq(accountHolders.holderId, id))),
      tx
        .select({ n: count() })
        .from(subAccounts)
        .where(and(eq(subAccounts.poolId, ctx.poolId), eq(subAccounts.holderId, id))),
    ]);
    return { accounts: owned[0]?.n ?? 0, subAccounts: named[0]?.n ?? 0 };
  },

  /**
   * Moves every reference of `fromId` to `intoId`, sets the target's aliases and deletes `fromId`.
   * The caller runs it inside one `withPool` transaction, so a failure leaves everything as it was.
   * An account that already names both people keeps only the target. Any table that later points
   * at `holders` must be added here (a test lists the foreign keys and fails until it is).
   */
  async merge(
    tx: PoolTx,
    ctx: PoolContext,
    fromId: string,
    intoId: string,
    aliases: string[],
  ): Promise<void> {
    const alreadyShared = tx
      .select({ accountId: accountHolders.accountId })
      .from(accountHolders)
      .where(and(eq(accountHolders.poolId, ctx.poolId), eq(accountHolders.holderId, intoId)));
    await tx
      .delete(accountHolders)
      .where(
        and(
          eq(accountHolders.poolId, ctx.poolId),
          eq(accountHolders.holderId, fromId),
          inArray(accountHolders.accountId, alreadyShared),
        ),
      );
    await tx
      .update(accountHolders)
      .set({ holderId: intoId })
      .where(and(eq(accountHolders.poolId, ctx.poolId), eq(accountHolders.holderId, fromId)));
    await tx
      .update(subAccounts)
      .set({ holderId: intoId })
      .where(and(eq(subAccounts.poolId, ctx.poolId), eq(subAccounts.holderId, fromId)));
    await tx
      .update(holders)
      .set({ aliases, updatedAt: new Date() })
      .where(and(eq(holders.poolId, ctx.poolId), eq(holders.id, intoId)));
    await tx.delete(holders).where(and(eq(holders.poolId, ctx.poolId), eq(holders.id, fromId)));
  },
};
