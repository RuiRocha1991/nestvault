import { sql } from 'drizzle-orm';
import { check, date, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

import { rate } from '../../columns';

export const INDEX_RATE_SOURCES = ['ecb', 'manual'] as const;
export type IndexRateSource = (typeof INDEX_RATE_SOURCES)[number];

// Global reference data (no `pool_id`, no RLS, listed in RLS_EXEMPT_TABLES): the monthly average of
// the Euribor, in percent, by month (`period` is the first day of the month). `app_rw` can only
// read it; the worker's monthly job writes it, so a pool cannot alter a rate another pool reads.
export const indexRates = pgTable(
  'index_rates',
  {
    rateIndex: text('rate_index').notNull(),
    period: date('period', { mode: 'string' }).notNull(),
    // May be negative (the Euribor was below zero from 2015 to 2022).
    rate: rate('rate').notNull(),
    source: text('source').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.rateIndex, table.period] }),
    check(
      'index_rates_index_known',
      sql`${table.rateIndex} in ('euribor_3m', 'euribor_6m', 'euribor_12m')`,
    ),
    check('index_rates_first_of_month', sql`extract(day from ${table.period}) = 1`),
    check('index_rates_rate_range', sql`${table.rate} between -10 and 100`),
    check('index_rates_source_known', sql`${table.source} in ('ecb', 'manual')`),
  ],
);

export type IndexRateRow = typeof indexRates.$inferSelect;
