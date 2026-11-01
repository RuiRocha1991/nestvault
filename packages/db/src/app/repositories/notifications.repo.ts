import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { AppDb, PoolTx } from '../client';
import {
  notificationReads,
  notifications,
  jobRequests,
  workerPools,
  type PoolJobRequest,
  type NotificationRow,
} from '../schema/notifications';

export type { NotificationRow };

/** What `markRead` did, see there. */
export type MarkReadResult = 'marked' | 'already' | 'missing';

/** An open notification with whether `userId` has read it. */
export interface OpenNotification extends NotificationRow {
  read: boolean;
}

/** In-app notifications. Every function filters by `ctx.poolId` (and RLS repeats it). */
export const notificationsRepo = {
  /**
   * Raises the reminder of a plan for a month (yyyy-mm). At most one exists per plan and month, even
   * after it was resolved, so it appears once. Returns whether this call created it.
   */
  async raisePlanReminder(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    planId: string,
    period: string,
  ): Promise<boolean> {
    const rows = await tx
      .insert(notifications)
      .values({ id, poolId: ctx.poolId, kind: 'plan_reminder', planId, period })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    return rows.length > 0;
  },

  /** The plan reminders not resolved yet. */
  async listOpenPlanReminders(tx: PoolTx, ctx: PoolContext): Promise<NotificationRow[]> {
    return tx
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.poolId, ctx.poolId),
          eq(notifications.kind, 'plan_reminder'),
          isNull(notifications.resolvedAt),
        ),
      );
  },

  /** Marks notifications as resolved (the thing they asked for was done); returns how many. */
  async resolve(tx: PoolTx, ctx: PoolContext, ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await tx
      .update(notifications)
      .set({ resolvedAt: new Date() })
      .where(
        and(
          eq(notifications.poolId, ctx.poolId),
          inArray(notifications.id, [...ids]),
          isNull(notifications.resolvedAt),
        ),
      )
      .returning({ id: notifications.id });
    return rows.length;
  },

  /** The open notifications, newest first, with the read state of `userId`. */
  async listOpen(tx: PoolTx, ctx: PoolContext, userId: string): Promise<OpenNotification[]> {
    const rows = await tx
      .select({
        notification: notifications,
        readAt: notificationReads.readAt,
      })
      .from(notifications)
      .leftJoin(
        notificationReads,
        and(
          eq(notificationReads.poolId, notifications.poolId),
          eq(notificationReads.notificationId, notifications.id),
          eq(notificationReads.userId, userId),
        ),
      )
      .where(and(eq(notifications.poolId, ctx.poolId), isNull(notifications.resolvedAt)))
      .orderBy(desc(notifications.createdAt), desc(notifications.id));
    return rows.map((row) => ({ ...row.notification, read: row.readAt !== null }));
  },

  /**
   * Records that `userId` read an open notification of this pool: `marked` when this call did it,
   * `already` when the user had read it, `missing` when it is not an open notification of this pool
   * (unknown, another pool's, or resolved), in which case nothing is written.
   */
  async markRead(
    tx: PoolTx,
    ctx: PoolContext,
    notificationId: string,
    userId: string,
  ): Promise<MarkReadResult> {
    const [found] = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.poolId, ctx.poolId),
          eq(notifications.id, notificationId),
          isNull(notifications.resolvedAt),
        ),
      );
    if (!found) return 'missing';
    const rows = await tx
      .insert(notificationReads)
      .values({ poolId: ctx.poolId, notificationId, userId })
      .onConflictDoNothing()
      .returning({ notificationId: notificationReads.notificationId });
    return rows.length > 0 ? 'marked' : 'already';
  },

  /**
   * Records that `userId` read every open notification of this pool in one statement
   * (`INSERT ... SELECT ... ON CONFLICT DO NOTHING`); returns how many were new.
   */
  async markAllRead(tx: PoolTx, ctx: PoolContext, userId: string): Promise<number> {
    const rows = await tx
      .insert(notificationReads)
      .select(
        tx
          .select({
            poolId: notifications.poolId,
            notificationId: notifications.id,
            userId: sql<string>`${userId}::uuid`.as('user_id'),
            readAt: sql<Date>`now()`.as('read_at'),
          })
          .from(notifications)
          .where(and(eq(notifications.poolId, ctx.poolId), isNull(notifications.resolvedAt))),
      )
      .onConflictDoNothing()
      .returning({ notificationId: notificationReads.notificationId });
    return rows.length;
  },
};

/**
 * The pools the worker runs per-pool jobs for (`worker_pools`, filled when a pool gets its first
 * account). Global: no pool context, readable by `worker_rw` only. Pass the worker's connection.
 */
export const workerPoolsRepo = {
  async list(db: Pick<AppDb, 'select'>): Promise<string[]> {
    const rows = await db
      .select({ poolId: workerPools.poolId })
      .from(workerPools)
      .orderBy(asc(workerPools.poolId));
    return rows.map((row) => row.poolId);
  },

  /**
   * Makes the list match the pools that have accounts: adds the ones a path without the trigger
   * (a restore) left out and removes the ones with no data left. Runs `reconcile_worker_pools()`, the
   * only way `worker_rw` changes the table.
   */
  async reconcile(db: Pick<AppDb, 'execute'>): Promise<{ added: number; removed: number }> {
    const result = await db.execute<{ added: number; removed: number }>(
      sql`select added, removed from reconcile_worker_pools()`,
    );
    const row = result.rows[0];
    if (!row) throw new Error('reconcile returned no row');
    return { added: row.added, removed: row.removed };
  },
};

/** A request waiting for the worker's relay. */
export interface PendingJobRequest {
  poolId: string;
  jobName: string;
  token: string;
  requestedAt: Date;
}

/**
 * Requests for a worker job about one pool (NES-147). The web side only calls `request`, inside the
 * pool's transaction: the row is written with the data it is about, or not at all. The pool comes
 * from the transaction's `app.pool_id` (the SQL function reads it), never from an argument. The
 * worker side (`pending`, `settle`) is global and needs `worker_rw`.
 */
export const jobRequestsRepo = {
  async request(tx: PoolTx, _ctx: PoolContext, job: PoolJobRequest): Promise<void> {
    await tx.execute(sql`select request_pool_job(${job})`);
  },

  async pending(db: Pick<AppDb, 'select'>, limit = 100): Promise<PendingJobRequest[]> {
    return db
      .select({
        poolId: jobRequests.poolId,
        jobName: jobRequests.jobName,
        token: jobRequests.token,
        requestedAt: jobRequests.requestedAt,
      })
      .from(jobRequests)
      .orderBy(asc(jobRequests.requestedAt))
      .limit(limit);
  },

  /** Removes a request once it became a queue run, unless a newer one replaced it meanwhile. */
  async settle(db: Pick<AppDb, 'delete'>, request: PendingJobRequest): Promise<void> {
    await db
      .delete(jobRequests)
      .where(
        and(
          eq(jobRequests.poolId, request.poolId),
          eq(jobRequests.jobName, request.jobName),
          eq(jobRequests.token, request.token),
        ),
      );
  },
};
