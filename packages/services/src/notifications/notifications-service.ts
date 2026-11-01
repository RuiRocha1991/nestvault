import {
  notificationsRepo,
  withPool,
  type IdentityDatabase,
  type PoolContext,
  type PoolRunner,
} from '@nestvault/db';

import { recordAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';
import { parseId } from '../investments/checks';
import { clientIpResolver } from '../rate-limit/client-ip';

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
   * even a viewer keeps their own). Idempotent. A notification that is not open in this pool
   * (unknown, another pool's, resolved) answers 404. Audited as `notification.read` (the id only)
   * when this call newly marks it; a repeat writes no entry.
   */
  markRead(headers: Headers, poolId: string, id: string): Promise<void>;
  /**
   * Marks every open notification of the pool as read for the caller only (`pool.read`). Audited as
   * one `notification.read_all` entry with the count (none when nothing changed).
   */
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

// Audit entries hold ids and counts only, never notification content.
export function createNotificationsService(deps: NotificationsServiceDeps): NotificationsService {
  const { auth, identity } = deps;
  const run = deps.run ?? withPool;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);

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
      const result = await run(ctx, (tx) =>
        notificationsRepo.markRead(tx, ctx, notificationId, userId),
      );
      if (result === 'missing') throw new NotFoundError();
      if (result === 'marked') {
        await recordAudit(identity, ctx, 'notification.read', {
          target: notificationId,
          ip: ipOf(headers),
        });
      }
    },

    async markAllRead(headers, poolId) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const userId = readerOf(ctx);
      const marked = await run(ctx, (tx) => notificationsRepo.markAllRead(tx, ctx, userId));
      if (marked > 0) {
        await recordAudit(identity, ctx, 'notification.read_all', {
          meta: { count: marked },
          ip: ipOf(headers),
        });
      }
      return MarkAllReadDto.parse({ marked });
    },
  };
}
