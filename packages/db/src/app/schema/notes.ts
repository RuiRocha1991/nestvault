import { sql } from 'drizzle-orm';
import { check, date, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { poolId } from '../../columns';

// One note per household and month (NES-45): what happened that month. `month` is always the first
// day of the month. `created_by` / `updated_by` are user ids of the identity database (ids only,
// the databases are never joined). `updated_at` is the version the editor sends back to detect a
// concurrent edit; it is written with millisecond precision so it survives a round trip through JSON.
export const monthNotes = pgTable(
  'month_notes',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    month: date('month', { mode: 'string' }).notNull(),
    body: text('body').notNull(),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('month_notes_pool_month_uniq').on(table.poolId, table.month),
    check('month_notes_first_day', sql`extract(day from ${table.month}) = 1`),
    check('month_notes_body_len', sql`char_length(${table.body}) between 1 and 10000`),
  ],
);

export type MonthNoteRow = typeof monthNotes.$inferSelect;
