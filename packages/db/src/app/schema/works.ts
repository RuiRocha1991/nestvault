import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { money, poolId, rate } from '../../columns';

import { properties } from './properties';
import { transactions } from './transactions';

export const WORK_STATUSES = ['planned', 'in_progress', 'done'] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

export const PAYMENT_STATUSES = ['planned', 'paid'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// A works project of a property (PRD "Real estate and loans", Pro): a kitchen, air conditioning…
// with its budget, supplier and deposit. What is paid and what is still due is derived from the
// payment phases in packages/domain; nothing derived is stored. `description` and `notes` are user
// content: escaped on render and never logged.
export const worksProjects = pgTable(
  'works_projects',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    propertyId: uuid('property_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    supplier: text('supplier'),
    budget: money('budget').notNull(),
    depositPct: rate('deposit_pct'),
    status: text('status').notNull().default('planned'),
    startDate: date('start_date', { mode: 'string' }),
    plannedEnd: date('planned_end', { mode: 'string' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('works_projects_pool_property_idx').on(table.poolId, table.propertyId),
    unique('works_projects_pool_id_uniq').on(table.poolId, table.id),
    check('works_projects_name_len', sql`char_length(${table.name}) between 1 and 80`),
    check(
      'works_projects_supplier_len',
      sql`${table.supplier} is null or char_length(${table.supplier}) between 1 and 80`,
    ),
    check('works_projects_budget_not_negative', sql`${table.budget} >= 0`),
    check(
      'works_projects_deposit_range',
      sql`${table.depositPct} is null or ${table.depositPct} between 0 and 100`,
    ),
    check(
      'works_projects_status_known',
      sql`${table.status} in ('planned', 'in_progress', 'done')`,
    ),
    check(
      'works_projects_dates_in_order',
      sql`${table.startDate} is null or ${table.plannedEnd} is null or ${table.plannedEnd} >= ${table.startDate}`,
    ),
    // Works are history of the property: it cannot be deleted while it has projects.
    foreignKey({
      name: 'works_projects_property_fk',
      columns: [table.poolId, table.propertyId],
      foreignColumns: [properties.poolId, properties.id],
    }).onDelete('restrict'),
  ],
);

// One payment phase of a project: the amount agreed, when it is planned and, once paid, when and
// from which bank movement. Linking a movement marks the phase paid.
export const worksPayments = pgTable(
  'works_payments',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    projectId: uuid('project_id').notNull(),
    description: text('description').notNull(),
    amount: money('amount').notNull(),
    plannedDate: date('planned_date', { mode: 'string' }),
    paidDate: date('paid_date', { mode: 'string' }),
    status: text('status').notNull().default('planned'),
    transactionId: uuid('transaction_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('works_payments_pool_project_idx').on(table.poolId, table.projectId),
    unique('works_payments_pool_id_uniq').on(table.poolId, table.id),
    // A bank movement pays at most one phase.
    uniqueIndex('works_payments_transaction_uniq')
      .on(table.poolId, table.transactionId)
      .where(sql`${table.transactionId} is not null`),
    check(
      'works_payments_description_len',
      sql`char_length(${table.description}) between 1 and 120`,
    ),
    check('works_payments_amount_positive', sql`${table.amount} > 0`),
    check('works_payments_status_known', sql`${table.status} in ('planned', 'paid')`),
    check(
      'works_payments_paid_has_date',
      sql`${table.status} <> 'paid' or ${table.paidDate} is not null`,
    ),
    check(
      'works_payments_planned_has_no_paid_date',
      sql`${table.status} <> 'planned' or ${table.paidDate} is null`,
    ),
    check(
      'works_payments_transaction_means_paid',
      sql`${table.transactionId} is null or ${table.status} = 'paid'`,
    ),
    foreignKey({
      name: 'works_payments_project_fk',
      columns: [table.poolId, table.projectId],
      foreignColumns: [worksProjects.poolId, worksProjects.id],
    }).onDelete('cascade'),
    // The bank movement may be deleted by hand: the phase then stays paid, without a link.
    foreignKey({
      name: 'works_payments_transaction_fk',
      columns: [table.poolId, table.transactionId],
      foreignColumns: [transactions.poolId, transactions.id],
    }).onDelete('set null'),
  ],
);

export type WorksProjectRow = typeof worksProjects.$inferSelect;
export type WorksPaymentRow = typeof worksPayments.$inferSelect;
