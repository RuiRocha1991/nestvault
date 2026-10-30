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

import { money, poolId, rate } from '../../columns';

import { loans } from './loans';

export const LOAN_EVENT_KINDS = ['prepayment', 'rate_review', 'renegotiation'] as const;
export type LoanEventKind = (typeof LOAN_EVENT_KINDS)[number];

export const PREPAYMENT_EFFECT_KINDS = ['reduce_installment', 'reduce_term'] as const;
export type PrepaymentEffectKind = (typeof PREPAYMENT_EFFECT_KINDS)[number];

// What happened to a loan after it started (PRD "Real estate and loans"): a prepayment, a rate review
// or a renegotiation. `date` is when it happened; `effective_from` is the date from which the
// installments feel it (the first installment due on or after it). The schedule is recomputed from
// these in packages/domain; nothing derived is stored.
export const loanEvents = pgTable(
  'loan_events',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    loanId: uuid('loan_id').notNull(),
    kind: text('kind').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    // Prepayment: capital paid off, the fee charged for it (a cost, not capital) and what it changes.
    amount: money('amount'),
    fee: money('fee'),
    effect: text('effect'),
    // Rate review: the index value read at the review and the spread. Review or renegotiation: the
    // new nominal annual rate and, when the bank announced it, the new installment.
    indexValue: rate('index_value'),
    spread: rate('spread'),
    annualRate: rate('annual_rate'),
    newInstallment: money('new_installment'),
    // Renegotiation: installments left counted from `effective_from`.
    termMonths: integer('term_months'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('loan_events_pool_loan_idx').on(table.poolId, table.loanId, table.effectiveFrom),
    unique('loan_events_pool_id_uniq').on(table.poolId, table.id),
    check(
      'loan_events_kind_known',
      sql`${table.kind} in ('prepayment', 'rate_review', 'renegotiation')`,
    ),
    check('loan_events_effective_after_date', sql`${table.effectiveFrom} >= ${table.date}`),
    check(
      'loan_events_prepayment_shape',
      // `is true`: a null amount or effect makes the condition null, and a check lets null through.
      sql`${table.kind} <> 'prepayment' or (${table.amount} > 0
        and ${table.effect} in ('reduce_installment', 'reduce_term')
        and ${table.annualRate} is null and ${table.termMonths} is null) is true`,
    ),
    check(
      'loan_events_prepayment_only_fields',
      sql`${table.kind} = 'prepayment' or (${table.amount} is null and ${table.fee} is null and ${table.effect} is null)`,
    ),
    check(
      'loan_events_review_shape',
      sql`${table.kind} <> 'rate_review' or (${table.annualRate} is not null and ${table.termMonths} is null)`,
    ),
    check(
      'loan_events_renegotiation_shape',
      sql`${table.kind} <> 'renegotiation' or ${table.annualRate} is not null or ${table.termMonths} is not null`,
    ),
    check('loan_events_fee_not_negative', sql`${table.fee} is null or ${table.fee} >= 0`),
    check(
      'loan_events_installment_positive',
      sql`${table.newInstallment} is null or ${table.newInstallment} > 0`,
    ),
    check(
      'loan_events_rate_range',
      sql`(${table.annualRate} is null or ${table.annualRate} between 0 and 100)
        and (${table.indexValue} is null or ${table.indexValue} between -10 and 100)
        and (${table.spread} is null or ${table.spread} between -10 and 100)`,
    ),
    check(
      'loan_events_term_range',
      sql`${table.termMonths} is null or ${table.termMonths} between 1 and 600`,
    ),
    foreignKey({
      name: 'loan_events_loan_fk',
      columns: [table.poolId, table.loanId],
      foreignColumns: [loans.poolId, loans.id],
    }).onDelete('cascade'),
  ],
);

export type LoanEventRow = typeof loanEvents.$inferSelect;
