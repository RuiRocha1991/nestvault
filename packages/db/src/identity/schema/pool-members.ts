import { sql } from 'drizzle-orm';
import { check, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { user } from './auth';
import { pools } from './pools';

/** One row per user and pool: the role decides the permission set (see requirePoolAccess). */
export const poolMembers = pgTable(
  'pool_members',
  {
    poolId: uuid('pool_id')
      .notNull()
      .references(() => pools.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // Mirrors ROLES in pool-context.ts; the check below keeps the column honest.
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.poolId, table.userId] }),
    index('pool_members_user_id_idx').on(table.userId),
    check('pool_members_role_check', sql`${table.role} in ('owner', 'admin', 'member', 'viewer')`),
  ],
);
