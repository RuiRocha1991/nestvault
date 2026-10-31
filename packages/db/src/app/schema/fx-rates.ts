import { sql } from 'drizzle-orm';
import { check, date, numeric, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

// Global reference data (no `pool_id`, no RLS, listed in RLS_EXEMPT_TABLES): EUR per one unit of a
// currency on a day. `app_rw` can only read it; the migration seeds it and the worker's fx.refresh job
// writes the ECB rates daily (never over a `manual` row). A pool's own override lives in `pool_settings`.
export const fxRates = pgTable(
  'fx_rates',
  {
    date: date('date', { mode: 'string' }).notNull(),
    ccy: text('ccy').notNull(),
    // numeric(18,8), not the numeric(9,6) of rates: a unit of a weak currency (JPY ~ 0.0062 EUR)
    // would lose four significant digits at 6 decimals.
    eurRate: numeric('eur_rate', { precision: 18, scale: 8 }).notNull(),
    source: text('source').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.date, table.ccy] }),
    check('fx_rates_ccy_format', sql`${table.ccy} ~ '^[A-Z]{3}$' and ${table.ccy} <> 'EUR'`),
    check('fx_rates_rate_positive', sql`${table.eurRate} > 0`),
    check('fx_rates_source', sql`${table.source} in ('seed', 'ecb', 'manual')`),
  ],
);

export type FxRateRow = typeof fxRates.$inferSelect;
