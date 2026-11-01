import { NOTIFICATION_KINDS, type OpenNotification } from '@nestvault/db';
import { z } from 'zod';

/** `GET .../notifications?status=`: `unread` keeps only what the caller has not read (default `all`). */
export const ListNotificationsQuery = z
  .object({ status: z.enum(['all', 'unread']).default('all') })
  .strict();
export type ListNotificationsQuery = z.input<typeof ListNotificationsQuery>;

/**
 * One open notification as the caller sees it. The text is not stored: the UI builds it from `kind`
 * and the ids through i18n. `read` is the caller's own state; what other members read is never shown.
 * A `plan_reminder` says the regular plan `planId` has no buy for `period` (`yyyy-mm`) yet.
 */
const NotificationKind = z.enum(NOTIFICATION_KINDS);

export const NotificationDto = z.object({
  id: z.uuid(),
  kind: NotificationKind,
  planId: z.uuid().nullable(),
  period: z.string().nullable(),
  createdAt: z.iso.datetime(),
  read: z.boolean(),
});
export type NotificationDto = z.infer<typeof NotificationDto>;

/** The open notifications of the pool, newest first, with how many the caller has not read. */
export const NotificationListDto = z.object({
  notifications: z.array(NotificationDto),
  /** Open notifications the caller has not read (the badge), whatever the `status` filter. */
  unreadCount: z.number().int().nonnegative(),
});
export type NotificationListDto = z.infer<typeof NotificationListDto>;

/** Answer of mark-all-as-read: how many notifications changed from unread to read for the caller. */
export const MarkAllReadDto = z.object({ marked: z.number().int().nonnegative() });
export type MarkAllReadDto = z.infer<typeof MarkAllReadDto>;

export const toNotificationDto = (row: OpenNotification): NotificationDto => ({
  id: row.id,
  // Validated, not cast: a kind the DTO does not know fails here instead of reaching the client.
  kind: NotificationKind.parse(row.kind),
  planId: row.planId,
  period: row.period,
  createdAt: row.createdAt.toISOString(),
  read: row.read,
});
