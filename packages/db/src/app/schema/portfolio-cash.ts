import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { money, poolId } from '../../columns';

import { accounts } from './accounts';
import { portfolios } from './portfolios';
import { transactions } from './transactions';

// Cash that left a portfolio for a bank account (NES-43). `amount` is signed and in EUR like the
// domain's `PortfolioCashMove`: negative takes cash out of the portfolio. `transaction_id` is the
// bank movement behind the move: the mirror this move created (`mirror`) or, later, the imported
// line that was matched to it. Deleting the move deletes only a mirror it created.
export const portfolioCashMoves = pgTable(
  'portfolio_cash_moves',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    portfolioId: uuid('portfolio_id').notNull(),
    accountId: uuid('account_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    amount: money('amount').notNull(),
    note: text('note'),
    transactionId: uuid('transaction_id'),
    mirror: boolean('mirror').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('portfolio_cash_moves_pool_id_uniq').on(table.poolId, table.id),
    index('portfolio_cash_moves_pool_portfolio_date_idx').on(
      table.poolId,
      table.portfolioId,
      table.date.desc(),
    ),
    index('portfolio_cash_moves_pool_account_idx').on(table.poolId, table.accountId),
    check('portfolio_cash_moves_amount_nonzero', sql`${table.amount} <> 0`),
    check(
      'portfolio_cash_moves_note_len',
      sql`${table.note} is null or char_length(${table.note}) <= 2000`,
    ),
    foreignKey({
      name: 'portfolio_cash_moves_portfolio_fk',
      columns: [table.poolId, table.portfolioId],
      foreignColumns: [portfolios.poolId, portfolios.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'portfolio_cash_moves_account_fk',
      columns: [table.poolId, table.accountId],
      foreignColumns: [accounts.poolId, accounts.id],
    }).onDelete('restrict'),
    // The bank movement may be deleted by hand: the move then stays, without a link.
    foreignKey({
      name: 'portfolio_cash_moves_transaction_fk',
      columns: [table.poolId, table.transactionId],
      foreignColumns: [transactions.poolId, transactions.id],
    }).onDelete('set null'),
  ],
);

export type PortfolioCashMoveRow = typeof portfolioCashMoves.$inferSelect;
