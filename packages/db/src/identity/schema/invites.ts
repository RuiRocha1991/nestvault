import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { pools } from './pools';

/** Case-insensitive text (the `citext` extension is created by the baseline migration). */
const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/**
 * An invitation to join a pool with a role (PRD 01). Only the SHA-256 hash of the token is stored,
 * so a database leak gives no working links. `accepted_at` is set in the transaction that inserts
 * the membership, which is what makes a link single use. A pool has at most one pending invite per
 * address (the partial unique index); a cancelled invite is deleted, an accepted one is kept.
 */
export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey(),
    poolId: uuid('pool_id')
      .notNull()
      .references(() => pools.id, { onDelete: 'cascade' }),
    email: citext('email').notNull(),
    // Mirrors ROLES in pool-context.ts; the check below keeps the column honest.
    role: text('role').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    invitedBy: uuid('invited_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invites_pool_email_pending_idx')
      .on(table.poolId, table.email)
      .where(sql`${table.acceptedAt} is null`),
    index('invites_pool_id_idx').on(table.poolId),
    check('invites_role_check', sql`${table.role} in ('owner', 'admin', 'member', 'viewer')`),
  ],
);
