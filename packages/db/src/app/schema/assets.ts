import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { money, poolId } from '../../columns';

// What the family can hold (PRD 04): one row per instrument, defined once and priced once for every
// account and portfolio that holds it. The ticker is unique inside a pool; `symbol` is what the
// market-data provider calls it (ADR 0002). `dps` is the annual dividend per share and `div_months`
// the calendar months it is paid in.
export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    ticker: text('ticker').notNull(),
    symbol: text('symbol'),
    name: text('name').notNull(),
    type: text('type').notNull(),
    currency: text('ccy').notNull(),
    sector: text('sector'),
    region: text('region'),
    dps: money('dps'),
    divMonths: smallint('div_months')
      .array()
      .notNull()
      .default(sql`'{}'::smallint[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('assets_pool_idx').on(table.poolId),
    unique('assets_pool_ticker_uniq').on(table.poolId, table.ticker),
    // Lets `asset_prices` point at `(pool_id, id)`, so a price cannot name another pool's asset.
    unique('assets_pool_id_uniq').on(table.poolId, table.id),
    check('assets_ticker_format', sql`${table.ticker} ~ '^[A-Z0-9][A-Z0-9.=^:_-]{0,19}$'`),
    check('assets_name_len', sql`char_length(${table.name}) between 1 and 80`),
    check(
      'assets_type',
      sql`${table.type} in ('stock', 'etf', 'fund', 'reit', 'ppr', 'bond', 'crypto', 'other')`,
    ),
    check('assets_currency_format', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check('assets_dps_nonneg', sql`${table.dps} >= 0`),
    check(
      'assets_div_months',
      sql`cardinality(${table.divMonths}) <= 12 and ${table.divMonths} <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]`,
    ),
  ],
);

// The price history of an asset: one price per day, in the asset's currency. A price is a unit
// price, so it keeps 6 decimals (money keeps 4). `source` says where it came from.
export const assetPrices = pgTable(
  'asset_prices',
  {
    poolId: poolId(),
    assetId: uuid('asset_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    price: numeric('price', { precision: 18, scale: 6 }).notNull(),
    source: text('source').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.assetId, table.date] }),
    index('asset_prices_pool_idx').on(table.poolId),
    check('asset_prices_positive', sql`${table.price} > 0`),
    check('asset_prices_source', sql`${table.source} in ('manual', 'bulk', 'provider')`),
    foreignKey({
      name: 'asset_prices_asset_fk',
      columns: [table.poolId, table.assetId],
      foreignColumns: [assets.poolId, assets.id],
    }).onDelete('cascade'),
  ],
);

export type AssetRow = typeof assets.$inferSelect;
export type AssetPriceRow = typeof assetPrices.$inferSelect;
