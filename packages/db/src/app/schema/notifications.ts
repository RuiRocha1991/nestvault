import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { poolId } from '../../columns';

import { plans } from './investments';

export const NOTIFICATION_KINDS = ['plan_reminder'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

// In-app notifications of a pool (NES-68). The text is not stored: the UI builds it from `kind` and
// the ids, through i18n. A `plan_reminder` says that a regular investment plan has no buy for
// `period` (yyyy-mm) yet; the worker creates it once per plan and month and resolves it when the buy
// exists. `resolved_at` hides it everywhere; the row stays as the record that it was raised.
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    kind: text('kind').notNull(),
    planId: uuid('plan_id'),
    period: text('period'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    unique('notifications_pool_id_uniq').on(table.poolId, table.id),
    uniqueIndex('notifications_plan_period_uniq')
      .on(table.poolId, table.planId, table.period)
      .where(sql`${table.kind} = 'plan_reminder'`),
    index('notifications_pool_open_idx')
      .on(table.poolId, table.createdAt.desc())
      .where(sql`${table.resolvedAt} is null`),
    check('notifications_kind_known', sql`${table.kind} in ('plan_reminder')`),
    check(
      'notifications_plan_reminder_shape',
      sql`${table.kind} <> 'plan_reminder' or (${table.planId} is not null and ${table.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')`,
    ),
    foreignKey({
      name: 'notifications_plan_fk',
      columns: [table.poolId, table.planId],
      foreignColumns: [plans.poolId, plans.id],
    }).onDelete('cascade'),
  ],
);

// Who has read which notification: the read state is per user. `user_id` is an identity-database id
// (the two databases only exchange ids), so it has no foreign key.
export const notificationReads = pgTable(
  'notification_reads',
  {
    poolId: poolId(),
    notificationId: uuid('notification_id').notNull(),
    userId: uuid('user_id').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.notificationId, table.userId] }),
    index('notification_reads_pool_user_idx').on(table.poolId, table.userId),
    foreignKey({
      name: 'notification_reads_notification_fk',
      columns: [table.poolId, table.notificationId],
      foreignColumns: [notifications.poolId, notifications.id],
    }).onDelete('cascade'),
  ],
);

// The pools that have data, for the jobs that run for every pool (the worker cannot see the identity
// database, and RLS hides every row without a pool). Global: no RLS, listed in RLS_EXEMPT_TABLES.
// Filled by a trigger on `accounts`; `app_rw` has no privilege on it, `worker_rw` reads it.
export const workerPools = pgTable('worker_pools', {
  poolId: uuid('pool_id').primaryKey(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

export type NotificationRow = typeof notifications.$inferSelect;
export type NotificationReadRow = typeof notificationReads.$inferSelect;
