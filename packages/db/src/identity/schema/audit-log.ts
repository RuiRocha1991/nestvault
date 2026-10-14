import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Insert-only log of security-relevant actions (NES-29). `identity_rw` can INSERT and SELECT but
// not UPDATE, DELETE or TRUNCATE: the migration revokes them, so a bug or an SQL injection in the
// application cannot rewrite history. No foreign keys on purpose: the trail outlives the pool and
// the user it is about (a cascade would be a delete). `pool_id` is null for account-level actions
// (sign-in); `user_id` is null when nobody is identified (failed sign-in) or the system acted.
// `meta` only ever holds allow-listed keys with scalar values (see services/audit).
/** Allow-listed keys with scalar values only. */
export type AuditMeta = Record<string, string | number | boolean>;

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    poolId: uuid('pool_id'),
    userId: uuid('user_id'),
    action: text('action').notNull(),
    target: text('target'),
    ip: text('ip'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    meta: jsonb('meta').$type<AuditMeta>().notNull().default({}),
  },
  (table) => [
    index('audit_log_pool_at_idx').on(table.poolId, table.at.desc()),
    index('audit_log_user_at_idx').on(table.userId, table.at.desc()),
  ],
);
