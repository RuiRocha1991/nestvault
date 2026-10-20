import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { poolId } from '../../columns';

// A basket of investments with its own currency (PRD 04). `targets` is the target allocation, a
// json object the service validates with zod before it is stored.
export const portfolios = pgTable(
  'portfolios',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    name: text('name').notNull(),
    color: text('color').notNull(),
    currency: text('ccy').notNull(),
    note: text('note'),
    targets: jsonb('targets')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('portfolios_pool_idx').on(table.poolId),
    unique('portfolios_pool_id_uniq').on(table.poolId, table.id),
    unique('portfolios_pool_name_uniq').on(table.poolId, table.name),
    check('portfolios_name_len', sql`char_length(${table.name}) between 1 and 60`),
    check('portfolios_color_format', sql`${table.color} ~ '^#[0-9a-fA-F]{6}$'`),
    check('portfolios_currency_format', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check('portfolios_note_len', sql`${table.note} is null or char_length(${table.note}) <= 2000`),
    check('portfolios_targets_object', sql`jsonb_typeof(${table.targets}) = 'object'`),
  ],
);

export type PortfolioRow = typeof portfolios.$inferSelect;
