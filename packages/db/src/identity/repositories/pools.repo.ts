import { and, count, eq, sql } from 'drizzle-orm';

import { parseRole, type Role } from '../../pool-context';
import type { IdentityDatabase, IdentityExecutor } from '../client';
import { auditLog, poolMembers, pools } from '../schema';

export interface PoolSummaryRow {
  id: string;
  name: string;
  role: Role;
  createdAt: Date;
  memberCount: number;
  /** The newest audit entry of the pool; `null` while it has none. */
  lastEntryAt: Date | null;
}

const MEMBER_COUNT = sql<number>`(select count(*)::int from ${poolMembers} pm2 where pm2.pool_id = ${pools.id})`;
const LAST_ENTRY = sql<Date | null>`(select max(a.at) from ${auditLog} a where a.pool_id = ${pools.id})`;

const POOL_DETAILS = {
  id: pools.id,
  name: pools.name,
  createdAt: pools.createdAt,
  memberCount: MEMBER_COUNT,
  lastEntryAt: LAST_ENTRY.mapWith((value) => (value ? new Date(value as string) : null)),
};

const SUMMARY = { role: poolMembers.role, ...POOL_DETAILS };

const toRow = (row: {
  id: string;
  name: string;
  role: string;
  createdAt: Date;
  memberCount: number;
  lastEntryAt: Date | null;
}): PoolSummaryRow | null => {
  const role = parseRole(row.role);
  return role ? { ...row, role } : null;
};

/** Every value is a bound parameter; the caller passes ids it got from a session or a guard. */
export const poolsRepo = {
  async insert(db: IdentityExecutor, pool: { id: string; name: string }): Promise<void> {
    await db.insert(pools).values({ id: pool.id, name: pool.name });
  },

  /** The pools the user belongs to, most recently active first. */
  async listForUser(db: IdentityDatabase['db'], userId: string): Promise<PoolSummaryRow[]> {
    const rows = await db
      .select(SUMMARY)
      .from(pools)
      .innerJoin(poolMembers, and(eq(poolMembers.poolId, pools.id), eq(poolMembers.userId, userId)))
      .orderBy(sql`coalesce(${LAST_ENTRY}, ${pools.createdAt}) desc`, sql`${pools.id} desc`);
    return rows.flatMap((row) => toRow(row) ?? []);
  },

  /** One pool of the user; `null` when it does not exist or the user is not a member. */
  async findForUser(
    db: IdentityDatabase['db'],
    poolId: string,
    userId: string,
  ): Promise<PoolSummaryRow | null> {
    const [row] = await db
      .select(SUMMARY)
      .from(pools)
      .innerJoin(poolMembers, and(eq(poolMembers.poolId, pools.id), eq(poolMembers.userId, userId)))
      .where(eq(pools.id, poolId))
      .limit(1);
    return row ? toRow(row) : null;
  },

  /** Pool details without a membership JOIN; for `open()` which already checked membership. */
  async findById(
    db: IdentityDatabase['db'],
    poolId: string,
  ): Promise<Omit<PoolSummaryRow, 'role'> | null> {
    const [row] = await db.select(POOL_DETAILS).from(pools).where(eq(pools.id, poolId)).limit(1);
    return row ?? null;
  },

  /** How many pools the user owns. Accepts a transaction handle so the check can be atomic. */
  async countOwnedBy(db: IdentityExecutor, userId: string): Promise<number> {
    const [row] = await db
      .select({ total: count() })
      .from(poolMembers)
      .where(and(eq(poolMembers.userId, userId), eq(poolMembers.role, 'owner')));
    return row?.total ?? 0;
  },
};
