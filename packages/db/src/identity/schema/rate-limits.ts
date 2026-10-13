import { index, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

// Fixed-window counters of the Postgres-backed rate limiter (no Redis). One row per
// (bucket, key, window). `key_hash` is an HMAC of the IP / email / session id, so the table never
// holds an address or an email in clear. Rows are deleted lazily once `expires_at` has passed.
export const rateLimits = pgTable(
  'rate_limits',
  {
    bucket: text('bucket').notNull(),
    keyHash: text('key_hash').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.bucket, table.keyHash, table.windowStart] }),
    index('rate_limits_expires_at_idx').on(table.expiresAt),
  ],
);
