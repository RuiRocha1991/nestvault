import { and, eq } from 'drizzle-orm';

import { parseRole, type Role } from '../../pool-context';
import type { IdentityDatabase, IdentityExecutor } from '../client';
import { poolMembers } from '../schema';

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
};
