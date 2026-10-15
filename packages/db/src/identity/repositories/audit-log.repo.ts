import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';

import { newId } from '../../ids';
import type { IdentityDatabase, IdentityExecutor } from '../client';
import { auditLog, type AuditMeta } from '../schema';

export type { AuditMeta };

export interface NewAuditEntry {
  poolId: string | null;
  userId: string | null;
  action: string;
  target: string | null;
  ip: string | null;
  meta: AuditMeta;
}

export interface AuditRow {
  id: string;
  userId: string | null;
  action: string;
  target: string | null;
  ip: string | null;
  at: Date;
  meta: AuditMeta;
}

/** The filters that choose which entries of a pool are listed (and counted). */
export interface AuditCriteria {
  action?: string;
  /** Any of these actions (a category). Never empty: callers omit it instead. */
  actions?: readonly string[];
  userId?: string;
  from?: Date;
  /** Exclusive upper bound. */
  to?: Date;
}

export interface AuditFilter extends AuditCriteria {
  limit: number;
  /** Rows to skip (page-based listing); not combined with `before`. */
  offset?: number;
  /** Only rows older than this instant: the cursor of the next page. */
  before?: { at: Date; id: string };
}

/** `at` at millisecond precision: the cursor travels as a JS date, which has nothing finer. */
const MS_AT = sql`date_trunc('milliseconds', ${auditLog.at})`;

const matching = (poolId: string, filter: AuditCriteria & { before?: AuditFilter['before'] }) =>
  and(
    eq(auditLog.poolId, poolId),
    filter.action ? eq(auditLog.action, filter.action) : undefined,
    filter.actions ? inArray(auditLog.action, [...filter.actions]) : undefined,
    filter.userId ? eq(auditLog.userId, filter.userId) : undefined,
    filter.from ? gte(auditLog.at, filter.from) : undefined,
    filter.to ? lt(auditLog.at, filter.to) : undefined,
    filter.before
      ? sql`(${MS_AT}, ${auditLog.id}) < (${filter.before.at.toISOString()}::timestamptz, ${filter.before.id}::uuid)`
      : undefined,
  );

/** Insert-only table: this repository has no update or delete on purpose (the grants forbid it). */
export const auditLogRepo = {
  async insert(db: IdentityExecutor, entry: NewAuditEntry): Promise<void> {
    await db.insert(auditLog).values({
      id: newId(),
      poolId: entry.poolId,
      userId: entry.userId,
      action: entry.action,
      target: entry.target,
      ip: entry.ip,
      meta: entry.meta,
    });
  },

  /** One pool's entries, newest first. Every value is a bound parameter. */
  async listForPool(
    db: IdentityDatabase['db'],
    poolId: string,
    filter: AuditFilter,
  ): Promise<AuditRow[]> {
    return db
      .select({
        id: auditLog.id,
        userId: auditLog.userId,
        action: auditLog.action,
        target: auditLog.target,
        ip: auditLog.ip,
        at: auditLog.at,
        meta: auditLog.meta,
      })
      .from(auditLog)
      .where(matching(poolId, filter))
      .orderBy(desc(MS_AT), desc(auditLog.id))
      .limit(filter.limit)
      .offset(filter.offset ?? 0);
  },

  /** How many entries of the pool match the criteria. */
  async countForPool(
    db: IdentityDatabase['db'],
    poolId: string,
    criteria: AuditCriteria,
  ): Promise<number> {
    const [row] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(matching(poolId, criteria));
    return row?.total ?? 0;
  },

  /** How many entries of one action a user has. */
  async countForUser(db: IdentityDatabase['db'], userId: string, action: string): Promise<number> {
    const [row] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(and(eq(auditLog.userId, userId), eq(auditLog.action, action)));
    return row?.total ?? 0;
  },
};
