import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { money, poolId } from '../../columns';

import { accounts } from './accounts';
import { properties } from './properties';
import { transactions } from './transactions';

export const PROPERTY_COST_KINDS = [
  'insurance_home',
  'insurance_life',
  'imi',
  'condominium',
  'other',
] as const;
export type PropertyCostKind = (typeof PROPERTY_COST_KINDS)[number];

export const COST_PERIODICITIES = ['monthly', 'annual', 'custom'] as const;
export type CostPeriodicity = (typeof COST_PERIODICITIES)[number];

// A cost of owning a property that is paid on its own, not inside a loan installment (PRD "Real
// estate and loans", Pro): the IMI, the condominium, an insurance paid directly. It repeats every
// `interval_months` from `start_date` until `end_date`. The occurrences, what is still expected and
// the totals are derived in packages/domain; nothing derived is stored. `name` is user content:
// escaped on render and never logged.
export const propertyCosts = pgTable(
  'property_costs',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    propertyId: uuid('property_id').notNull(),
    kind: text('kind').notNull(),
    name: text('name'),
    amount: money('amount').notNull(),
    periodicity: text('periodicity').notNull(),
    // Months between two occurrences: 1 for monthly, 12 for annual, 1–60 for a custom one.
    intervalMonths: integer('interval_months').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }),
    accountId: uuid('account_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('property_costs_pool_property_idx').on(table.poolId, table.propertyId),
    unique('property_costs_pool_id_uniq').on(table.poolId, table.id),
    check(
      'property_costs_kind_known',
      sql`${table.kind} in ('insurance_home', 'insurance_life', 'imi', 'condominium', 'other')`,
    ),
    check(
      'property_costs_name_len',
      sql`${table.name} is null or char_length(${table.name}) between 1 and 80`,
    ),
    check(
      'property_costs_other_has_name',
      sql`${table.kind} <> 'other' or ${table.name} is not null`,
    ),
    check('property_costs_amount_positive', sql`${table.amount} > 0`),
    check(
      'property_costs_periodicity_known',
      sql`${table.periodicity} in ('monthly', 'annual', 'custom')`,
    ),
    check(
      'property_costs_interval_matches',
      sql`(${table.periodicity} = 'monthly' and ${table.intervalMonths} = 1)
        or (${table.periodicity} = 'annual' and ${table.intervalMonths} = 12)
        or (${table.periodicity} = 'custom' and ${table.intervalMonths} between 1 and 60)`,
    ),
    check(
      'property_costs_dates_in_order',
      sql`${table.endDate} is null or ${table.endDate} >= ${table.startDate}`,
    ),
    // A property with costs cannot be deleted: end or move the costs first.
    foreignKey({
      name: 'property_costs_property_fk',
      columns: [table.poolId, table.propertyId],
      foreignColumns: [properties.poolId, properties.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'property_costs_account_fk',
      columns: [table.poolId, table.accountId],
      foreignColumns: [accounts.poolId, accounts.id],
    }).onDelete('restrict'),
  ],
);

// One occurrence of a cost that a bank debit paid. The occurrence is the cost's due date, which is
// derived, so this row is the only thing stored about it. Deleting the movement drops the row: the
// occurrence is expected again.
export const propertyCostPayments = pgTable(
  'property_cost_payments',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    costId: uuid('cost_id').notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    transactionId: uuid('transaction_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('property_cost_payments_pool_cost_idx').on(table.poolId, table.costId),
    unique('property_cost_payments_occurrence_uniq').on(table.poolId, table.costId, table.dueDate),
    // A bank movement pays at most one occurrence.
    unique('property_cost_payments_transaction_uniq').on(table.poolId, table.transactionId),
    foreignKey({
      name: 'property_cost_payments_cost_fk',
      columns: [table.poolId, table.costId],
      foreignColumns: [propertyCosts.poolId, propertyCosts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'property_cost_payments_transaction_fk',
      columns: [table.poolId, table.transactionId],
      foreignColumns: [transactions.poolId, transactions.id],
    }).onDelete('cascade'),
  ],
);

export type PropertyCostRow = typeof propertyCosts.$inferSelect;
export type PropertyCostPaymentRow = typeof propertyCostPayments.$inferSelect;
