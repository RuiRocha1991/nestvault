import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { money, poolId, rate } from '../../columns';

import { accounts } from './accounts';
import { properties } from './properties';

export const LOAN_KINDS = ['mortgage', 'car', 'personal'] as const;
export type LoanKind = (typeof LOAN_KINDS)[number];

export const RATE_TYPES = ['fixed', 'variable', 'mixed'] as const;
export type RateType = (typeof RATE_TYPES)[number];

export const RATE_INDEXES = ['euribor_3m', 'euribor_6m', 'euribor_12m'] as const;
export type RateIndex = (typeof RATE_INDEXES)[number];

export const INSTALLMENT_STATUSES = ['scheduled', 'paid'] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number];

export const INSTALLMENT_SOURCES = ['manual', 'import'] as const;
export type InstallmentSource = (typeof INSTALLMENT_SOURCES)[number];

export const FIELD_KINDS = ['builtin', 'custom'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

// A loan (PRD "Real estate and loans", Pro): a mortgage, a car loan or a personal one, optionally of
// a property. The conditions are stored; the projected schedule is computed in packages/domain from
// them and from the actual installments, so nothing derived is stored here.
export const loans = pgTable(
  'loans',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    propertyId: uuid('property_id'),
    principal: money('principal').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    // The due date of installment 1; the others fall every month after it.
    firstDueDate: date('first_due_date', { mode: 'string' }).notNull(),
    termMonths: integer('term_months').notNull(),
    rateType: text('rate_type').notNull(),
    rateIndex: text('rate_index'),
    spread: rate('spread'),
    // The nominal annual rate in force, in percent (index + spread for a variable loan).
    annualRate: rate('annual_rate').notNull(),
    fixedUntil: date('fixed_until', { mode: 'string' }),
    reviewMonths: integer('review_months'),
    paymentDay: integer('payment_day').notNull(),
    debitAccountId: uuid('debit_account_id'),
    // Figures from the FINE (the bank's standard information sheet).
    taeg: rate('taeg'),
    tan: rate('tan'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('loans_pool_idx').on(table.poolId),
    unique('loans_pool_id_uniq').on(table.poolId, table.id),
    check('loans_name_len', sql`char_length(${table.name}) between 1 and 80`),
    check('loans_kind_known', sql`${table.kind} in ('mortgage', 'car', 'personal')`),
    check('loans_principal_positive', sql`${table.principal} > 0`),
    check('loans_term_range', sql`${table.termMonths} between 1 and 600`),
    check('loans_rate_type_known', sql`${table.rateType} in ('fixed', 'variable', 'mixed')`),
    check(
      'loans_rate_index_known',
      sql`${table.rateIndex} is null or ${table.rateIndex} in ('euribor_3m', 'euribor_6m', 'euribor_12m')`,
    ),
    check('loans_annual_rate_range', sql`${table.annualRate} between 0 and 100`),
    check(
      'loans_spread_range',
      sql`${table.spread} is null or ${table.spread} between -10 and 100`,
    ),
    check(
      'loans_review_range',
      sql`${table.reviewMonths} is null or ${table.reviewMonths} between 1 and 24`,
    ),
    check('loans_payment_day_range', sql`${table.paymentDay} between 1 and 28`),
    check('loans_taeg_range', sql`${table.taeg} is null or ${table.taeg} between 0 and 100`),
    check('loans_tan_range', sql`${table.tan} is null or ${table.tan} between 0 and 100`),
    // A property is only pointed at, never cascaded: delete or move its loans first.
    foreignKey({
      name: 'loans_property_fk',
      columns: [table.poolId, table.propertyId],
      foreignColumns: [properties.poolId, properties.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'loans_debit_account_fk',
      columns: [table.poolId, table.debitAccountId],
      foreignColumns: [accounts.poolId, accounts.id],
    }).onDelete('restrict'),
  ],
);

// The optional installment components of one loan: the built-in ones (life, home and credit
// insurance, fees, stamp tax) and custom ones. Capital and interest are always there. A disabled
// field keeps its values; it only stops counting.
export const loanFields = pgTable(
  'loan_fields',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    loanId: uuid('loan_id').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    kind: text('kind').notNull(),
    enabled: boolean('enabled').notNull(),
    countsAsExpense: boolean('counts_as_expense').notNull().default(true),
    defaultAmount: money('default_amount'),
    appliesFrom: date('applies_from', { mode: 'string' }),
  },
  (table) => [
    index('loan_fields_pool_loan_idx').on(table.poolId, table.loanId),
    unique('loan_fields_pool_id_uniq').on(table.poolId, table.id),
    unique('loan_fields_key_uniq').on(table.poolId, table.loanId, table.key),
    check('loan_fields_key_format', sql`${table.key} ~ '^[a-zA-Z][a-zA-Z0-9]{0,39}$'`),
    check('loan_fields_label_len', sql`char_length(${table.label}) between 1 and 60`),
    check('loan_fields_kind_known', sql`${table.kind} in ('builtin', 'custom')`),
    check(
      'loan_fields_default_not_negative',
      sql`${table.defaultAmount} is null or ${table.defaultAmount} >= 0`,
    ),
    foreignKey({
      name: 'loan_fields_loan_fk',
      columns: [table.poolId, table.loanId],
      foreignColumns: [loans.poolId, loans.id],
    }).onDelete('cascade'),
  ],
);

// One actual installment: what the bank charged, itemized. The built-in optional components are
// columns; the custom ones are in `loan_installment_amounts`. The total and the installments left
// are derived (packages/domain), never stored.
export const loanInstallments = pgTable(
  'loan_installments',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    loanId: uuid('loan_id').notNull(),
    number: integer('number').notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    capital: money('capital').notNull(),
    interest: money('interest').notNull(),
    fees: money('fees').notNull().default('0'),
    stampTax: money('stamp_tax').notNull().default('0'),
    lifeInsurance: money('life_insurance').notNull().default('0'),
    homeInsurance: money('home_insurance').notNull().default('0'),
    creditInsurance: money('credit_insurance').notNull().default('0'),
    status: text('status').notNull().default('paid'),
    source: text('source').notNull().default('manual'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('loan_installments_pool_loan_idx').on(table.poolId, table.loanId, table.number),
    unique('loan_installments_pool_id_uniq').on(table.poolId, table.id),
    unique('loan_installments_number_uniq').on(table.poolId, table.loanId, table.number),
    check('loan_installments_number_positive', sql`${table.number} >= 1`),
    check(
      'loan_installments_amounts_not_negative',
      sql`${table.capital} >= 0 and ${table.interest} >= 0 and ${table.fees} >= 0
        and ${table.stampTax} >= 0 and ${table.lifeInsurance} >= 0
        and ${table.homeInsurance} >= 0 and ${table.creditInsurance} >= 0`,
    ),
    check('loan_installments_status_known', sql`${table.status} in ('scheduled', 'paid')`),
    check('loan_installments_source_known', sql`${table.source} in ('manual', 'import')`),
    foreignKey({
      name: 'loan_installments_loan_fk',
      columns: [table.poolId, table.loanId],
      foreignColumns: [loans.poolId, loans.id],
    }).onDelete('cascade'),
  ],
);

// The amount of a custom field in one installment.
export const loanInstallmentAmounts = pgTable(
  'loan_installment_amounts',
  {
    poolId: poolId(),
    installmentId: uuid('installment_id').notNull(),
    fieldId: uuid('field_id').notNull(),
    amount: money('amount').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.installmentId, table.fieldId] }),
    index('loan_installment_amounts_pool_idx').on(table.poolId),
    check('loan_installment_amounts_not_negative', sql`${table.amount} >= 0`),
    foreignKey({
      name: 'loan_installment_amounts_installment_fk',
      columns: [table.poolId, table.installmentId],
      foreignColumns: [loanInstallments.poolId, loanInstallments.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'loan_installment_amounts_field_fk',
      columns: [table.poolId, table.fieldId],
      foreignColumns: [loanFields.poolId, loanFields.id],
    }).onDelete('cascade'),
  ],
);

export type LoanRow = typeof loans.$inferSelect;
export type LoanFieldRow = typeof loanFields.$inferSelect;
export type LoanInstallmentRow = typeof loanInstallments.$inferSelect;
export type LoanInstallmentAmountRow = typeof loanInstallmentAmounts.$inferSelect;
