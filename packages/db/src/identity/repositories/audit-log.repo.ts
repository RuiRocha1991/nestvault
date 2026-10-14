import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';

import { newId } from '../../ids';
import type { IdentityDatabase } from '../client';
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

export interface AuditFilter {
  action?: string;
  from?: Date;
  /** Exclusive upper bound. */
  to?: Date;
  limit: number;
  /** Only rows older than this instant: the cursor of the next page. */
  before?: { at: Date; id: string };
}

/** `at` at millisecond precision: the cursor travels as a JS date, which has nothing finer. */
const MS_AT = sql`date_trunc('milliseconds', ${auditLog.at})`;

/** Insert-only table: this repository has no update or delete on purpose (the grants forbid it). */
export const auditLogRepo = {
  async insert(db: IdentityDatabase['db'], entry: NewAuditEntry): Promise<void> {
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
      .where(
        and(
          eq(auditLog.poolId, poolId),
          filter.action ? eq(auditLog.action, filter.action) : undefined,
          filter.from ? gte(auditLog.at, filter.from) : undefined,
          filter.to ? lt(auditLog.at, filter.to) : undefined,
          filter.before
            ? sql`(${MS_AT}, ${auditLog.id}) < (${filter.before.at.toISOString()}::timestamptz, ${filter.before.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(MS_AT), desc(auditLog.id))
      .limit(filter.limit);
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
