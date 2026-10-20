import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { money, poolId, quantity } from '../../columns';

import { accounts, subAccounts } from './accounts';
import { assets } from './assets';
import { portfolios } from './portfolios';

// A regular investment plan: a fixed amount bought in one asset on a day of every month. Running
// it creates the month's buy (`investment_ops.plan_id`).
export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    portfolioId: uuid('portfolio_id').notNull(),
    assetId: uuid('asset_id').notNull(),
    accountId: uuid('account_id'),
    subAccountId: uuid('sub_account_id'),
    amount: money('amount').notNull(),
    day: smallint('day').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('plans_pool_portfolio_idx').on(table.poolId, table.portfolioId),
    unique('plans_pool_id_uniq').on(table.poolId, table.id),
    check('plans_amount_positive', sql`${table.amount} > 0`),
    check('plans_day_range', sql`${table.day} between 1 and 28`),
    check(
      'plans_sub_needs_account',
      sql`${table.subAccountId} is null or ${table.accountId} is not null`,
    ),
    foreignKey({
      name: 'plans_portfolio_fk',
      columns: [table.poolId, table.portfolioId],
      foreignColumns: [portfolios.poolId, portfolios.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'plans_asset_fk',
      columns: [table.poolId, table.assetId],
      foreignColumns: [assets.poolId, assets.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'plans_account_fk',
      columns: [table.poolId, table.accountId],
      foreignColumns: [accounts.poolId, accounts.id],
    }).onDelete('cascade'),
    // The sub-account must belong to the plan's account (MATCH SIMPLE: skipped when null).
    foreignKey({
      name: 'plans_sub_account_fk',
      columns: [table.poolId, table.accountId, table.subAccountId],
      foreignColumns: [subAccounts.poolId, subAccounts.accountId, subAccounts.id],
    }),
  ],
);

// Buys, sells and dividends. `qty` and `price` are used by buys and sells; `amount` (net), `gross`
// and `tax` by dividends. `ext_id` is the broker's own id on imports. A buy made by a plan carries
// `plan_id` and the `plan_period` (yyyy-mm), unique per plan, so running a plan twice in a month
// cannot create two buys.
export const investmentOps = pgTable(
  'investment_ops',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    portfolioId: uuid('portfolio_id').notNull(),
    assetId: uuid('asset_id').notNull(),
    accountId: uuid('account_id'),
    subAccountId: uuid('sub_account_id'),
    type: text('type').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    qty: quantity('qty'),
    price: numeric('price', { precision: 18, scale: 6 }),
    fee: money('fee'),
    amount: money('amount'),
    gross: money('gross'),
    tax: money('tax'),
    fromCash: boolean('from_cash').notNull().default(false),
    planId: uuid('plan_id'),
    planPeriod: text('plan_period'),
    extId: text('ext_id'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('investment_ops_pool_id_uniq').on(table.poolId, table.id),
    index('investment_ops_pool_portfolio_date_idx').on(
      table.poolId,
      table.portfolioId,
      table.date.desc(),
    ),
    index('investment_ops_pool_asset_idx').on(table.poolId, table.assetId),
    index('investment_ops_pool_account_idx').on(table.poolId, table.accountId),
    uniqueIndex('investment_ops_account_ext_uniq')
      .on(table.poolId, table.accountId, table.extId)
      .where(sql`${table.extId} is not null`),
    uniqueIndex('investment_ops_plan_period_uniq')
      .on(table.poolId, table.planId, table.planPeriod)
      .where(sql`${table.planId} is not null`),
    check('investment_ops_type', sql`${table.type} in ('buy', 'sell', 'dividend')`),
    check(
      'investment_ops_trade_fields',
      sql`${table.type} not in ('buy', 'sell') or (coalesce(${table.qty} > 0, false) and coalesce(${table.price} >= 0, false))`,
    ),
    check(
      'investment_ops_dividend_fields',
      sql`${table.type} <> 'dividend' or ${table.amount} is not null`,
    ),
    check('investment_ops_fee_nonneg', sql`${table.fee} >= 0`),
    check(
      'investment_ops_sub_needs_account',
      sql`${table.subAccountId} is null or ${table.accountId} is not null`,
    ),
    check(
      'investment_ops_ext_id_len',
      sql`${table.extId} is null or char_length(${table.extId}) between 1 and 120`,
    ),
    check(
      'investment_ops_plan_period_format',
      sql`${table.planPeriod} is null or ${table.planPeriod} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
    check(
      'investment_ops_note_len',
      sql`${table.note} is null or char_length(${table.note}) <= 2000`,
    ),
    foreignKey({
      name: 'investment_ops_portfolio_fk',
      columns: [table.poolId, table.portfolioId],
      foreignColumns: [portfolios.poolId, portfolios.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'investment_ops_asset_fk',
      columns: [table.poolId, table.assetId],
      foreignColumns: [assets.poolId, assets.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'investment_ops_account_fk',
      columns: [table.poolId, table.accountId],
      foreignColumns: [accounts.poolId, accounts.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'investment_ops_sub_account_fk',
      columns: [table.poolId, table.accountId, table.subAccountId],
      foreignColumns: [subAccounts.poolId, subAccounts.accountId, subAccounts.id],
    }),
    foreignKey({
      name: 'investment_ops_plan_fk',
      columns: [table.poolId, table.planId],
      foreignColumns: [plans.poolId, plans.id],
    }).onDelete('set null'),
  ],
);

export type PlanRow = typeof plans.$inferSelect;
export type InvestmentOpRow = typeof investmentOps.$inferSelect;
