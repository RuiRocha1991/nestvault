import {
  notificationsRepo,
  withPool,
  type IdentityDatabase,
  type PoolContext,
  type PoolRunner,
} from '@nestvault/db';

import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';
import { parseId } from '../investments/checks';

import {
  ListNotificationsQuery,
  MarkAllReadDto,
  NotificationListDto,
  toNotificationDto,
} from './schemas';

export interface NotificationsService {
  /**
   * The open notifications of the pool with the caller's own read state (any member, `pool.read`).
   * Resolved notifications and other pools' notifications are never returned.
   */
  list(headers: Headers, poolId: string, query: unknown): Promise<NotificationListDto>;
  /**
   * Marks one notification as read for the caller only (`pool.read`: the read state is personal, so
   * even a viewer keeps their own). Idempotent; a notification of another pool answers 404.
   */
  markRead(headers: Headers, poolId: string, id: string): Promise<void>;
  /** Marks every open notification of the pool as read for the caller only (`pool.read`). */
  markAllRead(headers: Headers, poolId: string): Promise<MarkAllReadDto>;
}

export interface NotificationsServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  trustedProxyHops?: number;
}

/** The read state belongs to a person: background actors have none. */
function readerOf(ctx: PoolContext): string {
  if (ctx.actor.kind !== 'user') throw new ForbiddenError();
  return ctx.actor.userId;
}

// Read state is the caller's own bookkeeping, not household data, so marking as read is not written
// to the audit log (it would only be noise); `notification_reads` keeps `read_at` per user.
export function createNotificationsService(deps: NotificationsServiceDeps): NotificationsService {
  const { auth, identity } = deps;
  const run = deps.run ?? withPool;

  return {
    async list(headers, poolId, query) {
      const session = await requireSession(auth, headers);
      const parsed = ListNotificationsQuery.safeParse(query);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const userId = readerOf(ctx);
      const rows = await run(ctx, (tx) => notificationsRepo.listOpen(tx, ctx, userId));
      const unread = rows.filter((row) => !row.read);
      const shown = parsed.data.status === 'unread' ? unread : rows;
      return NotificationListDto.parse({
        notifications: shown.map(toNotificationDto),
        unreadCount: unread.length,
      });
    },

    async markRead(headers, poolId, id) {
      const session = await requireSession(auth, headers);
      const notificationId = parseId(id);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const userId = readerOf(ctx);
      const found = await run(ctx, (tx) =>
        notificationsRepo.markRead(tx, ctx, notificationId, userId),
      );
      if (!found) throw new NotFoundError();
    },

    async markAllRead(headers, poolId) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const userId = readerOf(ctx);
      const marked = await run(ctx, (tx) => notificationsRepo.markAllRead(tx, ctx, userId));
      return MarkAllReadDto.parse({ marked });
    },
  };
}
