import { and, eq } from 'drizzle-orm';

import { ROLES, type Role } from '../../pool-context';
import type { IdentityDatabase } from '../client';
import { poolMembers, pools } from '../schema';

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
    return ROLES.find((candidate) => candidate === row?.role) ?? null;
  },

  async insert(
    db: IdentityDatabase['db'],
    member: { poolId: string; userId: string; role: Role },
  ): Promise<void> {
    await db
      .insert(poolMembers)
      .values({ poolId: member.poolId, userId: member.userId, role: member.role });
  },
};

export const poolsRepo = {
  async insert(db: IdentityDatabase['db'], pool: { id: string; name: string }): Promise<void> {
    await db.insert(pools).values({ id: pool.id, name: pool.name });
  },
};
