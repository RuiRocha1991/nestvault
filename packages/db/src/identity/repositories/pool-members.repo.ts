import { and, asc, eq, gt, max, sql } from 'drizzle-orm';

import { parseRole, type Role } from '../../pool-context';
import type { IdentityDatabase, IdentityExecutor } from '../client';
import { poolMembers, session, user } from '../schema';

/** A member of a pool as the members screen lists them. */
export interface MemberRow {
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: Date;
  /**
   * The newest activity of one of the member's unexpired sessions that is working in this pool,
   * or `null`. Work in another pool is not shown here on purpose: a pool never learns when its
   * members were active elsewhere.
   */
  lastActivityAt: Date | null;
}

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

  /** The members of one pool with their display name, by name. No email leaves this query. */
  async listWithNames(
    db: IdentityDatabase['db'],
    poolId: string,
  ): Promise<{ userId: string; name: string }[]> {
    return db
      .select({ userId: poolMembers.userId, name: user.name })
      .from(poolMembers)
      .innerJoin(user, eq(user.id, poolMembers.userId))
      .where(eq(poolMembers.poolId, poolId))
      .orderBy(asc(user.name), asc(poolMembers.userId));
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

  /** The pool's members with name, email and last activity, owners first and then by name. */
  async listMembers(
    db: IdentityDatabase['db'],
    poolId: string,
    now: Date = new Date(),
  ): Promise<MemberRow[]> {
    const rows = await db
      .select({
        userId: poolMembers.userId,
        name: user.name,
        email: user.email,
        role: poolMembers.role,
        joinedAt: poolMembers.createdAt,
        lastActivityAt: max(session.updatedAt),
      })
      .from(poolMembers)
      .innerJoin(user, eq(user.id, poolMembers.userId))
      .leftJoin(
        session,
        and(
          eq(session.userId, poolMembers.userId),
          eq(session.activePoolId, poolMembers.poolId),
          gt(session.expiresAt, now),
        ),
      )
      .where(eq(poolMembers.poolId, poolId))
      .groupBy(poolMembers.userId, user.name, user.email, poolMembers.role, poolMembers.createdAt)
      .orderBy(
        sql`case ${poolMembers.role} when 'owner' then 0 when 'admin' then 1 when 'member' then 2 else 3 end`,
        asc(user.name),
        asc(poolMembers.userId),
      );
    return rows.flatMap((row) => {
      const role = parseRole(row.role);
      return role ? [{ ...row, role }] : [];
    });
  },

  /**
   * Locks the pool's membership rows until the transaction ends and returns them. Every change of
   * a role or a membership starts here, so two parallel requests cannot both leave the pool
   * without an owner.
   */
  async lockMembers(
    db: IdentityExecutor,
    poolId: string,
  ): Promise<{ userId: string; role: Role }[]> {
    const rows = await db
      .select({ userId: poolMembers.userId, role: poolMembers.role })
      .from(poolMembers)
      .where(eq(poolMembers.poolId, poolId))
      .orderBy(asc(poolMembers.userId))
      .for('update');
    return rows.flatMap((row) => {
      const role = parseRole(row.role);
      return role ? [{ userId: row.userId, role }] : [];
    });
  },

  /** Gives the member a new role. `false` when the user is not a member of the pool. */
  async updateRole(
    db: IdentityExecutor,
    poolId: string,
    userId: string,
    role: Role,
  ): Promise<boolean> {
    const updated = await db
      .update(poolMembers)
      .set({ role })
      .where(and(eq(poolMembers.poolId, poolId), eq(poolMembers.userId, userId)))
      .returning({ userId: poolMembers.userId });
    return updated.length > 0;
  },

  /** Removes the membership. `false` when the user was not a member of the pool. */
  async remove(db: IdentityExecutor, poolId: string, userId: string): Promise<boolean> {
    const removed = await db
      .delete(poolMembers)
      .where(and(eq(poolMembers.poolId, poolId), eq(poolMembers.userId, userId)))
      .returning({ userId: poolMembers.userId });
    return removed.length > 0;
  },
};
