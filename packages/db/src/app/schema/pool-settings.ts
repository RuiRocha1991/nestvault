import { sql } from 'drizzle-orm';
import {
  check,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { poolId, rate } from '../../columns';

// One row per pool (PRD 04): what the prototype kept in `settings`. A pool without a row uses the
// defaults of the service, so nothing has to be created when a pool is. `fx_overrides` maps a
// currency to its EUR rate for this pool only ({"USD": "0.92"}); its shape is validated by zod.
export const poolSettings = pgTable(
  'pool_settings',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    transferWindowDays: smallint('transfer_window_days').notNull().default(3),
    depositTax: rate('deposit_tax').notNull().default('28'),
    dividendTax: rate('dividend_tax').notNull().default('28'),
    displayCurrency: text('display_currency').notNull().default('EUR'),
    fxOverrides: jsonb('fx_overrides')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('pool_settings_pool_uniq').on(table.poolId),
    check('pool_settings_window', sql`${table.transferWindowDays} between 0 and 30`),
    check('pool_settings_deposit_tax', sql`${table.depositTax} between 0 and 100`),
    check('pool_settings_dividend_tax', sql`${table.dividendTax} between 0 and 100`),
    check('pool_settings_currency', sql`${table.displayCurrency} ~ '^[A-Z]{3}$'`),
    check('pool_settings_overrides_object', sql`jsonb_typeof(${table.fxOverrides}) = 'object'`),
  ],
);

export type PoolSettingsRow = typeof poolSettings.$inferSelect;
