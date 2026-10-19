import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { money, poolId, rate } from '../../columns';

import { holders } from './holders';

// Where the family's money sits (PRD 04): checking, savings, term deposits and brokerage accounts,
// each with one or more holders. Money is a decimal string; the IBAN is stored normalized (no
// spaces, upper case) and is unique inside a pool, never across pools. `portfolio_id` is a plain
// uuid for now: the foreign key to `portfolios` comes with that table (NES-42).
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    type: text('type').notNull(),
    name: text('name').notNull(),
    institution: text('institution'),
    iban: text('iban'),
    currency: text('ccy').notNull(),
    opening: money('opening').notNull().default('0'),
    openingDate: date('opening_date', { mode: 'string' }),
    trackCash: boolean('track_cash').notNull().default(true),
    groupName: text('group_name'),
    portfolioId: uuid('portfolio_id'),
    rate: rate('rate'),
    xtbAccountNo: text('xtb_account_no'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('accounts_pool_idx').on(table.poolId),
    // Lets the child tables point at `(pool_id, id)`, so a row cannot name another pool's account.
    unique('accounts_pool_id_uniq').on(table.poolId, table.id),
    uniqueIndex('accounts_pool_iban_uniq')
      .on(table.poolId, table.iban)
      .where(sql`${table.iban} is not null`),
    check(
      'accounts_type',
      sql`${table.type} in ('checking', 'savings', 'term_deposit', 'brokerage')`,
    ),
    check('accounts_name_len', sql`char_length(${table.name}) between 1 and 80`),
    check('accounts_iban_format', sql`${table.iban} ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'`),
    check('accounts_currency_format', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    // A term deposit is always in euros (the domain values it that way).
    check(
      'accounts_term_deposit_eur',
      sql`${table.type} <> 'term_deposit' or ${table.currency} = 'EUR'`,
    ),
    check('accounts_rate_range', sql`${table.rate} between 0 and 100`),
  ],
);

// Who owns the account. The holder is restricted, not cascaded: the service refuses to remove a
// person who still owns an account, and the database repeats it.
export const accountHolders = pgTable(
  'account_holders',
  {
    poolId: poolId(),
    accountId: uuid('account_id').notNull(),
    holderId: uuid('holder_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.holderId] }),
    index('account_holders_pool_idx').on(table.poolId),
    index('account_holders_holder_idx').on(table.poolId, table.holderId),
    foreignKey({
      name: 'account_holders_account_fk',
      columns: [table.poolId, table.accountId],
      foreignColumns: [accounts.poolId, accounts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'account_holders_holder_fk',
      columns: [table.poolId, table.holderId],
      foreignColumns: [holders.poolId, holders.id],
    }).onDelete('restrict'),
  ],
);

// Brokerage sub-accounts (one per holder in a joint account, e.g. Banco Invest with 4 subscriptions
// of the same product). Only brokerage accounts have them: the service checks the type.
export const subAccounts = pgTable(
  'sub_accounts',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    accountId: uuid('account_id').notNull(),
    name: text('name').notNull(),
    holderId: uuid('holder_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('sub_accounts_pool_account_idx').on(table.poolId, table.accountId),
    unique('sub_accounts_pool_id_uniq').on(table.poolId, table.id),
    unique('sub_accounts_account_name_uniq').on(table.accountId, table.name),
    check('sub_accounts_name_len', sql`char_length(${table.name}) between 1 and 60`),
    foreignKey({
      name: 'sub_accounts_account_fk',
      columns: [table.poolId, table.accountId],
      foreignColumns: [accounts.poolId, accounts.id],
    }).onDelete('cascade'),
    // MATCH SIMPLE: a sub-account without a holder (null) is not checked.
    foreignKey({
      name: 'sub_accounts_holder_fk',
      columns: [table.poolId, table.holderId],
      foreignColumns: [holders.poolId, holders.id],
    }).onDelete('restrict'),
  ],
);

export type AccountRow = typeof accounts.$inferSelect;
export type SubAccountRow = typeof subAccounts.$inferSelect;
export type AccountHolderRow = typeof accountHolders.$inferSelect;
