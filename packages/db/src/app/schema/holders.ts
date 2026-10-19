import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { poolId } from '../../columns';

// People of the household (PRD 04): they own accounts and sub-accounts and their names are matched
// in bank descriptions through `aliases` (stored upper case, without accents). A child can be a
// holder without a login; `user_id` links a holder to a member of the pool in nestvault_identity
// (an id only, the two databases are never joined, so the service checks the membership).
export const holders = pgTable(
  'holders',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    name: text('name').notNull(),
    color: text('color').notNull(),
    aliases: text('aliases')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    userId: uuid('user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('holders_pool_idx').on(table.poolId),
    // Lets other tables point at `(pool_id, id)`, so a row cannot name another pool's person.
    unique('holders_pool_id_uniq').on(table.poolId, table.id),
    // A member is at most one holder of the pool.
    uniqueIndex('holders_pool_user_uniq')
      .on(table.poolId, table.userId)
      .where(sql`${table.userId} is not null`),
    check('holders_name_len', sql`char_length(${table.name}) between 1 and 60`),
    check('holders_color_hex', sql`${table.color} ~ '^#[0-9A-Fa-f]{6}$'`),
    check('holders_aliases_max', sql`cardinality(${table.aliases}) <= 10`),
  ],
);

export type HolderRow = typeof holders.$inferSelect;
