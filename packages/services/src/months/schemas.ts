import { z } from 'zod';

import { MonthNoteDto, MonthParam } from '../notes/schemas';

/** A decimal string (EUR unless said otherwise). */
const Amount = z.string();

export const NOTABLE_REASONS = ['note', 'top-expense', 'top-income'] as const;

export const MonthCategoryDto = z.object({
  /** `null` for expenses without a category. */
  categoryId: z.uuid().nullable(),
  value: Amount,
  budget: Amount.nullable(),
  /** `value / budget` in percent, null without a budget. */
  budgetUsedPct: Amount.nullable(),
  previousAverage: Amount,
  difference: Amount,
});

export const NotableTransactionDto = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  accountName: z.string(),
  date: z.iso.date(),
  description: z.string(),
  /** In EUR; negative leaves the account. */
  amount: Amount,
  kind: z.enum(['income', 'expense', 'refund', 'transfer', 'investment']),
  reasons: z.array(z.enum(NOTABLE_REASONS)),
  /** User content: shown as plain text only. */
  note: z.string().nullable(),
  noteUpdatedBy: z.uuid().nullable(),
  noteUpdatedAt: z.iso.datetime().nullable(),
});

export const MonthOperationDto = z.object({
  id: z.uuid(),
  date: z.iso.date(),
  type: z.enum(['buy', 'sell', 'div']),
  assetId: z.uuid(),
  ticker: z.string(),
  qty: Amount.nullable(),
  /** Effect on cash in EUR: negative for a buy. */
  cashEffect: Amount,
  note: z.string().nullable(),
  noteUpdatedBy: z.uuid().nullable(),
  noteUpdatedAt: z.iso.datetime().nullable(),
});

export const MonthOperationsDto = z.object({
  portfolioId: z.uuid().nullable(),
  portfolioName: z.string().nullable(),
  operations: z.array(MonthOperationDto),
});

/** One month of the timeline: the last 12 months ending with the reviewed one. */
export const TimelineMonthDto = z.object({
  month: MonthParam,
  income: Amount,
  expenses: Amount,
  savings: Amount,
  netWorth: Amount,
  hasNote: z.boolean(),
});

export const MonthReviewDto = z.object({
  month: MonthParam,
  /** The month before; always present. */
  previousMonth: MonthParam,
  /** The month after, null when `month` is the current month or later. */
  nextMonth: MonthParam.nullable(),
  income: Amount,
  expenses: Amount,
  savings: Amount,
  /** In percent, null without income. */
  savingsRatePct: Amount.nullable(),
  netWorthEnd: Amount,
  netWorthPrevious: Amount,
  netWorthChange: Amount,
  invested: Amount,
  dividendsReceived: Amount,
  interestReceived: Amount,
  categories: z.array(MonthCategoryDto),
  notable: z.array(NotableTransactionDto),
  operations: z.array(MonthOperationsDto),
  note: MonthNoteDto,
  timeline: z.array(TimelineMonthDto),
});
export type MonthReviewDto = z.infer<typeof MonthReviewDto>;
