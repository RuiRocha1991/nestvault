import { ListNotificationsQuery, MarkAllReadDto, NotificationListDto } from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, json, registry } from './registry';

// In-app notifications and the caller's read state (NES-148, follow-up of NES-68). Guards in the
// service: session, input validation, membership (404 for non-members), `pool.read` (read state is
// personal, so every member, viewers included, keeps their own), then `withPool` (RLS). Marking as
// read is audited (`notification.read` with the id, `notification.read_all` with the count; never
// content). Other members' read state is never exposed.

const pool = z.object({ poolId: z.uuid() });
const item = z.object({ poolId: z.uuid(), id: z.uuid() });

registry.registerPath({
  method: 'get',
  path: '/api/v1/pools/{poolId}/notifications',
  operationId: 'listNotifications',
  summary: 'The open notifications of the pool with my read state',
  description:
    "Any member may read. Newest first; resolved notifications are not listed. `read` is the caller's own state. `status=unread` keeps only unread ones; `unreadCount` always counts every unread open notification (the badge). The text is not stored: build it from `kind`, `planId` and `period` (a `plan_reminder` says the plan has no buy for `period`, `yyyy-mm`). An unknown `status`, a repeated `status` or an extra query parameter answers 400.",
  tags: ['Notifications'],
  request: { params: pool, query: ListNotificationsQuery },
  responses: {
    200: { description: 'The notifications', ...json(NotificationListDto) },
    ...errorResponses(400, 401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/notifications/{id}/read',
  operationId: 'markNotificationRead',
  summary: 'Mark one notification as read (for me only)',
  description:
    'Any member. Idempotent. Other members keep their own state. A notification that is not open in this pool (unknown, of another pool, or resolved) answers 404. The first time it is audited as `notification.read` (id only); a repeat writes no entry.',
  tags: ['Notifications'],
  request: { params: item },
  responses: {
    204: { description: 'Marked as read' },
    ...errorResponses(401, 404, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/pools/{poolId}/notifications/read-all',
  operationId: 'markAllNotificationsRead',
  summary: 'Mark every open notification as read (for me only)',
  description:
    'Any member. `marked` is how many changed from unread to read for the caller; calling it again answers 0. Audited as one `notification.read_all` entry with the count (none when 0). Other members keep their own state.',
  tags: ['Notifications'],
  request: { params: pool },
  responses: {
    200: { description: 'How many were marked', ...json(MarkAllReadDto) },
    ...errorResponses(401, 404, 429, 500),
  },
});
