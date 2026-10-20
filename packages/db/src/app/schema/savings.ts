import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { money, poolId, rate } from '../../columns';

import { accounts } from './accounts';

/** `m` = months, `d` = days (payment period and term). */
export const PERIOD_UNITS = ['m', 'd'] as const;

// A savings product (PRD 04): the terms a bank offers, copied into each deposit that uses it. `tax`
// empty means the pool's default. The interest goes to `pay_to_account_id`, or stays in the deposit
// (capitalizes) when there is none; `fund_from_account_id` funds the deposit and gets the money
// back at maturity. The accounts are restricted: the service refuses to delete an account that a
// product names, and the database repeats it.
export const savingsProducts = pgTable(
  'savings_products',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    name: text('name').notNull(),
    institution: text('institution'),
    rate: rate('rate').notNull(),
    payN: smallint('pay_n'),
    payU: text('pay_u'),
    termN: smallint('term_n'),
    termU: text('term_u'),
    tax: rate('tax'),
    payToAccountId: uuid('pay_to_account_id'),
    fundFromAccountId: uuid('fund_from_account_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('savings_products_pool_id_uniq').on(table.poolId, table.id),
    unique('savings_products_pool_name_uniq').on(table.poolId, table.name),
    check('savings_products_name_len', sql`char_length(${table.name}) between 1 and 80`),
    check('savings_products_rate_range', sql`${table.rate} between 0 and 100`),
    check('savings_products_tax_range', sql`${table.tax} between 0 and 100`),
    check(
      'savings_products_pay_period',
      sql`(${table.payN} is null) = (${table.payU} is null) and (${table.payN} is null or (${table.payN} between 1 and 3650 and ${table.payU} in ('m', 'd')))`,
    ),
    check(
      'savings_products_term',
      sql`(${table.termN} is null) = (${table.termU} is null) and (${table.termN} is null or (${table.termN} between 1 and 3650 and ${table.termU} in ('m', 'd')))`,
    ),
    foreignKey({
      name: 'savings_products_pay_to_fk',
      columns: [table.poolId, table.payToAccountId],
      foreignColumns: [accounts.poolId, accounts.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'savings_products_fund_from_fk',
      columns: [table.poolId, table.fundFromAccountId],
      foreignColumns: [accounts.poolId, accounts.id],
    }).onDelete('restrict'),
  ],
);

// The application behind a term-deposit account: one per account, with its own capital and dates.
// The product's terms are copied in when it is created, so changing a product later never changes
// a deposit that already exists; `product_id` only says where it came from (for grouping).
export const deposits = pgTable(
  'deposits',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    accountId: uuid('account_id').notNull(),
    productId: uuid('product_id'),
    capital: money('capital').notNull(),
    start: date('start_date', { mode: 'string' }).notNull(),
    rate: rate('rate').notNull(),
    payN: smallint('pay_n'),
    payU: text('pay_u'),
    termN: smallint('term_n'),
    termU: text('term_u'),
    capitalize: boolean('capitalize').notNull().default(false),
    tax: rate('tax'),
    payToAccountId: uuid('pay_to_account_id'),
    fundFromAccountId: uuid('fund_from_account_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('deposits_pool_id_uniq').on(table.poolId, table.id),
    unique('deposits_pool_account_uniq').on(table.poolId, table.accountId),
    index('deposits_pool_product_idx').on(table.poolId, table.productId),
    check('deposits_capital_positive', sql`${table.capital} > 0`),
    check('deposits_rate_range', sql`${table.rate} between 0 and 100`),
    check('deposits_tax_range', sql`${table.tax} between 0 and 100`),
    check(
      'deposits_pay_period',
      sql`(${table.payN} is null) = (${table.payU} is null) and (${table.payN} is null or (${table.payN} between 1 and 3650 and ${table.payU} in ('m', 'd')))`,
    ),
    check(
      'deposits_term',
      sql`(${table.termN} is null) = (${table.termU} is null) and (${table.termN} is null or (${table.termN} between 1 and 3650 and ${table.termU} in ('m', 'd')))`,
    ),
    foreignKey({
      name: 'deposits_account_fk',
      columns: [table.poolId, table.accountId],
      foreignColumns: [accounts.poolId, accounts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'deposits_product_fk',
      columns: [table.poolId, table.productId],
      foreignColumns: [savingsProducts.poolId, savingsProducts.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'deposits_pay_to_fk',
      columns: [table.poolId, table.payToAccountId],
      foreignColumns: [accounts.poolId, accounts.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'deposits_fund_from_fk',
      columns: [table.poolId, table.fundFromAccountId],
      foreignColumns: [accounts.poolId, accounts.id],
    }).onDelete('restrict'),
  ],
);

// Interest received by a savings account, entered by hand (statements add theirs later). `amount`
// is the net interest, in the account's currency. The account is restricted: an account with
// interest entries cannot be deleted.
export const interestEntries = pgTable(
  'interest_entries',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    accountId: uuid('account_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    amount: money('amount').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('interest_entries_pool_account_date_idx').on(table.poolId, table.accountId, table.date),
    check('interest_entries_amount_positive', sql`${table.amount} > 0`),
    check(
      'interest_entries_note_len',
      sql`${table.note} is null or char_length(${table.note}) <= 500`,
    ),
    foreignKey({
      name: 'interest_entries_account_fk',
      columns: [table.poolId, table.accountId],
      foreignColumns: [accounts.poolId, accounts.id],
    }).onDelete('restrict'),
  ],
);

export type SavingsProductRow = typeof savingsProducts.$inferSelect;
export type DepositRow = typeof deposits.$inferSelect;
export type InterestEntryRow = typeof interestEntries.$inferSelect;
