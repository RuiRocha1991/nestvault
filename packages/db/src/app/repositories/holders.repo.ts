import { and, asc, eq } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
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

  /**
   * How many accounts and sub-accounts name this holder. Those tables arrive with NES-39, which
   * replaces this with the real count; until then nothing references a holder.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the signature NES-39 fills in
  countReferences(_tx: PoolTx, _ctx: PoolContext, _id: string): Promise<number> {
    return Promise.resolve(0);
  },
};
