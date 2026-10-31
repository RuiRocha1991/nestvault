import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { AppDb, PoolTx } from '../client';
import {
  notificationReads,
  notifications,
  workerPools,
  type NotificationRow,
} from '../schema/notifications';

export type { NotificationRow };

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

  /** Records that `userId` read a notification of this pool; false when it is not one. */
  async markRead(
    tx: PoolTx,
    ctx: PoolContext,
    notificationId: string,
    userId: string,
  ): Promise<boolean> {
    const [found] = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.poolId, ctx.poolId), eq(notifications.id, notificationId)));
    if (!found) return false;
    await tx
      .insert(notificationReads)
      .values({ poolId: ctx.poolId, notificationId, userId })
      .onConflictDoNothing();
    return true;
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
};
