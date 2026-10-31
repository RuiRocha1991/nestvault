import { sql } from 'drizzle-orm';
import { check, date, jsonb, pgTable, primaryKey, timestamp } from 'drizzle-orm/pg-core';

import { money, poolId } from '../../columns';

// The household's net worth on one day (NES-69), in EUR, stored by the worker (`snapshots.daily`,
// today) or by the backfill (past month ends). The overview evolution chart reads these instead of
// recomputing the past. `by_ccy` is the native-currency split ({"USD": "1200.0000"}). One row per
// pool and day, so a run repeated the same day replaces the row.
export const netWorthSnapshots = pgTable(
  'net_worth_snapshots',
  {
    poolId: poolId(),
    date: date('date', { mode: 'string' }).notNull(),
    net: money('net').notNull(),
    cash: money('cash').notNull(),
    savings: money('savings').notNull(),
    investments: money('investments').notNull(),
    byCcy: jsonb('by_ccy')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.poolId, table.date] }),
    check('net_worth_snapshots_by_ccy_object', sql`jsonb_typeof(${table.byCcy}) = 'object'`),
  ],
);

export type NetWorthSnapshotRow = typeof netWorthSnapshots.$inferSelect;
