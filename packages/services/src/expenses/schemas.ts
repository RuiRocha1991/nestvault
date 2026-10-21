import { TRANSACTION_KINDS } from '@nestvault/db';
import { z } from 'zod';

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const NO_CONTROL = /^[^\u0000-\u001f\u007f]+$/;
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Flag = z.enum(['true', 'false']).transform((value) => value === 'true');

/** `?month=yyyy-mm`; the current month (Lisbon) when left out. */
export const ExpensesSummaryQuery = z.object({ month: Month.optional() }).strict();
export type ExpensesSummaryQuery = z.input<typeof ExpensesSummaryQuery>;

/** The filters of the Movimentos list, without sort and paging: totals cover every match. */
export const MovementTotalsQuery = z
  .object({
    month: Month.optional(),
    accountId: z.uuid().optional(),
    categoryId: z.union([z.uuid(), z.literal('none')]).optional(),
    kind: z.enum(TRANSACTION_KINDS).optional(),
    q: z.string().trim().min(1).max(100).regex(NO_CONTROL).optional(),
    withNotes: Flag.optional(),
  })
  .strict();
export type MovementTotalsQuery = z.input<typeof MovementTotalsQuery>;

/** A decimal string in EUR. */
const Money = z.string();

export const MonthFlowDto = z.object({
  /** Income of the month, in EUR. */
  income: Money,
  /** Expenses net of refunds; transfers and investments are not expenses. */
  expenses: Money,
  refunds: Money,
  /** Buys of the month. */
  invested: Money,
  savings: Money,
  /** `savings / income` as a decimal string (0.25 = 25 %); null without income. */
  savingsRate: z.string().nullable(),
});

export const CategoryExpenseDto = z.object({
  /** Null for expenses without a category. */
  categoryId: z.uuid().nullable(),
  value: Money,
  budget: Money.nullable(),
  /** `value / budget`; null without a budget. */
  budgetUsed: z.string().nullable(),
  /** Average of the same category over the three previous months. */
  previousAverage: Money,
  difference: Money,
});

export const MonthPointDto = z.object({
  /** `yyyy-mm`. */
  month: Month,
  income: Money,
  expenses: Money,
});

export const ExpensesSummaryDto = z.object({
  month: Month,
  flow: MonthFlowDto,
  /** Expenses by category, largest first. */
  categories: z.array(CategoryExpenseDto),
  /** The twelve months ending with `month`, oldest first. */
  history: z.array(MonthPointDto),
});
export type ExpensesSummaryDto = z.infer<typeof ExpensesSummaryDto>;

export const MovementTotalsDto = z.object({
  /** Income movements, in EUR. */
  income: Money,
  /** Expenses net of refunds, in EUR. */
  expenses: Money,
  /** Money sent to investments, in EUR. */
  invested: Money,
  /** The inflow side of internal transfers, in EUR (not an expense). */
  transfers: Money,
  /** Movements without a category. */
  uncategorized: z.number().int(),
  count: z.number().int(),
  /** EUR per unit of each foreign currency in use, so the client can move an amount between totals. */
  rates: z.record(z.string(), z.string()),
});
export type MovementTotalsDto = z.infer<typeof MovementTotalsDto>;

/** How many movements each category holds and how many each rule is the first match for. */
export const ExpensesUsageDto = z.object({
  /** By category id; categories without movements are left out. */
  categories: z.record(z.uuid(), z.number().int()),
  /** By rule id; rules matching nothing are left out. */
  rules: z.record(z.uuid(), z.number().int()),
});
export type ExpensesUsageDto = z.infer<typeof ExpensesUsageDto>;
