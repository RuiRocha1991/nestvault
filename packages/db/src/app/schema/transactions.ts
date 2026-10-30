import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { money, poolId } from '../../columns';

import { accounts } from './accounts';
import { categories } from './categories';
import { loanInstallments } from './loans';

// Bank movements (PRD 04). `amount` is in the account's currency and negative leaves the account.
// `hash` identifies a movement inside its account so an import never duplicates it. `category_id`
// is a global or one of the pool's own categories: the row policy (see the migration) requires it
// to be visible to the pool. `pair_id` links the two sides of an internal transfer.
export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    accountId: uuid('account_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    description: text('description').notNull(),
    amount: money('amount').notNull(),
    categoryId: uuid('category_id'),
    /** Internal transfer between the household's own accounts. */
    transfer: boolean('is_transfer').notNull().default(false),
    pairId: uuid('pair_id'),
    /** The user fixed the transfer flag: detection never changes it. */
    transferLocked: boolean('kind_lock').notNull().default(false),
    /** The user chose the category: rules and detection never override it. */
    manualCategory: boolean('manual_category').notNull().default(false),
    /** Linked to a term deposit's interest, so it is not counted twice (NES-40). */
    depositInterest: boolean('dep_link').notNull().default(false),
    hash: text('hash').notNull(),
    importBatchId: uuid('import_batch_id'),
    /**
     * The loan installment this debit paid (NES-100): only its interest, fees, taxes and insurances
     * count as an expense, the capital is savings. At most one debit per installment.
     */
    loanInstallmentId: uuid('loan_installment_id'),
    /** Free text about the movement; user content, written through NES-45's endpoint. */
    note: text('note'),
    /** Who last wrote the note and when. */
    noteUpdatedBy: uuid('note_updated_by'),
    noteUpdatedAt: timestamp('note_updated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('transactions_pool_id_uniq').on(table.poolId, table.id),
    uniqueIndex('transactions_account_hash_uniq').on(table.poolId, table.accountId, table.hash),
    index('transactions_pool_date_idx').on(table.poolId, table.date.desc(), table.id.desc()),
    index('transactions_pool_account_date_idx').on(
      table.poolId,
      table.accountId,
      table.date.desc(),
    ),
    uniqueIndex('transactions_loan_installment_uniq')
      .on(table.poolId, table.loanInstallmentId)
      .where(sql`${table.loanInstallmentId} is not null`),
    index('transactions_category_idx').on(table.poolId, table.categoryId),
    check('transactions_description_len', sql`char_length(${table.description}) between 1 and 500`),
    check(
      'transactions_note_len',
      sql`${table.note} is null or char_length(${table.note}) <= 2000`,
    ),
    check(
      'transactions_not_own_pair',
      sql`${table.pairId} is null or ${table.pairId} <> ${table.id}`,
    ),
    foreignKey({
      name: 'transactions_account_fk',
      columns: [table.poolId, table.accountId],
      foreignColumns: [accounts.poolId, accounts.id],
    }).onDelete('restrict'),
    // A plain foreign key: a global category has no pool. The row policy checks visibility.
    foreignKey({
      name: 'transactions_category_fk',
      columns: [table.categoryId],
      foreignColumns: [categories.id],
    }).onDelete('restrict'),
    // The installment may be deleted: the debit then stays, unlinked, and counts as a plain expense.
    foreignKey({
      name: 'transactions_loan_installment_fk',
      columns: [table.poolId, table.loanInstallmentId],
      foreignColumns: [loanInstallments.poolId, loanInstallments.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'transactions_pair_fk',
      columns: [table.poolId, table.pairId],
      foreignColumns: [table.poolId, table.id],
    }),
  ],
);

// Keyword rules that categorize movements, tried in `position` order (PRD 04). A rule may be
// restricted to one account; its category is global or the pool's own.
export const categoryRules = pgTable(
  'category_rules',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    keyword: text('keyword').notNull(),
    categoryId: uuid('category_id').notNull(),
    accountId: uuid('account_id'),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('category_rules_pool_position_idx').on(table.poolId, table.position, table.id),
    check('category_rules_keyword_len', sql`char_length(${table.keyword}) between 2 and 60`),
    foreignKey({
      name: 'category_rules_category_fk',
      columns: [table.categoryId],
      foreignColumns: [categories.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'category_rules_account_fk',
      columns: [table.poolId, table.accountId],
      foreignColumns: [accounts.poolId, accounts.id],
    }).onDelete('cascade'),
  ],
);

export type TransactionRow = typeof transactions.$inferSelect;
export type CategoryRuleRow = typeof categoryRules.$inferSelect;
