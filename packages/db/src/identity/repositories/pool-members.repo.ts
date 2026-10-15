import { and, eq } from 'drizzle-orm';

import { parseRole, type Role } from '../../pool-context';
import type { IdentityDatabase, IdentityExecutor } from '../client';
import { poolMembers, user } from '../schema';

/** Ids and values are bound parameters. The caller validates the ids as UUIDs first. */
export const poolMembersRepo = {
  /**
   * The user's role in the pool, or `null` when the user is not a member. A pool that does not
   * exist gives the same `null`, which is what lets the guard answer both with one 404.
   */
  async findRole(db: IdentityDatabase['db'], poolId: string, userId: string): Promise<Role | null> {
    const [row] = await db
      .select({ role: poolMembers.role })
      .from(poolMembers)
      .where(and(eq(poolMembers.poolId, poolId), eq(poolMembers.userId, userId)))
      .limit(1);
    return parseRole(row?.role);
  },

  async insert(
    db: IdentityExecutor,
    member: { poolId: string; userId: string; role: Role },
  ): Promise<void> {
    await db
      .insert(poolMembers)
      .values({ poolId: member.poolId, userId: member.userId, role: member.role });
  },

  /**
   * Adds the member unless the user already belongs to the pool (the existing role is kept).
   * `false` when the user was already a member.
   */
  async insertIfAbsent(
    db: IdentityExecutor,
    member: { poolId: string; userId: string; role: Role },
  ): Promise<boolean> {
    const inserted = await db
      .insert(poolMembers)
      .values({ poolId: member.poolId, userId: member.userId, role: member.role })
      .onConflictDoNothing()
      .returning({ userId: poolMembers.userId });
    return inserted.length > 0;
  },

  /** True when an account with this address (case-insensitive) is a member of the pool. */
  async existsByEmail(db: IdentityExecutor, poolId: string, email: string): Promise<boolean> {
    const [row] = await db
      .select({ userId: poolMembers.userId })
      .from(poolMembers)
      .innerJoin(user, eq(user.id, poolMembers.userId))
      .where(and(eq(poolMembers.poolId, poolId), eq(user.email, email)))
      .limit(1);
    return !!row;
  },
};
