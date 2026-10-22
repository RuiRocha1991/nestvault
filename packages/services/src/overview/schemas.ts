import { z } from 'zod';

// The overview screen ("Visão geral", PRD FR — Overview dashboard) in one response. Money and
// percentages are decimal strings (percentages already multiplied by 100); the UI formats them.

export const OVERVIEW_RANGES = ['6', '12', '24', 'all'] as const;
export type OverviewRange = (typeof OVERVIEW_RANGES)[number];

/** The longest evolution chart: "all" stops here. */
export const OVERVIEW_MAX_MONTHS = 120;

export const OverviewQuery = z
  .object({
    /** Months shown in the evolution chart and the sparklines. */
    range: z.enum(OVERVIEW_RANGES).default('12'),
  })
  .strict();
export type OverviewQuery = z.input<typeof OverviewQuery>;

const Decimal = z.string();

export const OverviewGoalDto = z.object({
  id: z.uuid(),
  name: z.string(),
  color: z.string(),
  /** 0-100. */
  progress: Decimal,
  status: z.enum(['reached', 'on_track', 'behind', 'eta', 'no_contribution', 'tracking']),
  /** `yyyy-mm` when the status is `eta`. */
  etaMonth: z.string().nullable(),
});
export type OverviewGoalDto = z.infer<typeof OverviewGoalDto>;

export const OverviewCategoryDto = z.object({
  categoryId: z.uuid().nullable(),
  /** Set for a global category (named through i18n); `null` for a custom one or none. */
  systemKey: z.string().nullable(),
  /** Name of a custom category. */
  name: z.string().nullable(),
  color: z.string(),
  value: Decimal,
});

export const OverviewPortfolioDto = z.object({
  id: z.uuid(),
  name: z.string(),
  color: z.string(),
  currency: z.string(),
  /** Positions plus cash, in the portfolio's currency. */
  value: Decimal,
  /** Total return, percent. */
  returnPct: Decimal,
});

export const OverviewDto = z.object({
  asOf: z.iso.date(),
  range: z.enum(OVERVIEW_RANGES),
  /** No accounts and no operations yet: the screen shows the call to action. */
  empty: z.boolean(),
  kpis: z.object({
    netWorth: z.object({
      value: Decimal,
      /** Change against the previous month, percent. */
      changePct: Decimal,
      spark: z.array(Decimal),
    }),
    investments: z.object({
      value: Decimal,
      /** Total return of the open positions, percent. */
      returnPct: Decimal,
      spark: z.array(Decimal),
    }),
    passiveIncome: z.object({
      /** Expected gross income of the open positions per year. */
      annual: Decimal,
      monthly: Decimal,
      yieldPct: Decimal,
      /** Interest received in the last 12 months. */
      interest12: Decimal,
      spark: z.array(Decimal),
    }),
    monthExpenses: z.object({
      value: Decimal,
      /** Sum of the monthly budgets of the expense categories, `null` while there is none. */
      budget: Decimal.nullable(),
      budgetUsedPct: Decimal.nullable(),
      /** Change against the previous month, percent. */
      changePct: Decimal,
      spark: z.array(Decimal),
    }),
  }),
  evolution: z.object({
    /** `yyyy-mm`, oldest first. */
    months: z.array(z.string()),
    total: z.array(Decimal),
    investments: z.array(Decimal),
  }),
  /** Goals have no storage yet: empty until the goals module lands. */
  goals: z.array(OverviewGoalDto),
  portfolios: z.array(OverviewPortfolioDto),
  expenses: z.object({
    month: z.string(),
    total: Decimal,
    /** Largest first. */
    categories: z.array(OverviewCategoryDto),
  }),
  dividends: z.object({
    /** The next 12 months, the current one first. */
    months: z.array(z.string()),
    /** Gross forecast per month. */
    values: z.array(Decimal),
    total: Decimal,
    /** False when the pool has no dividend at all (received or expected): the card is not shown. */
    hasDividends: z.boolean(),
  }),
});
export type OverviewDto = z.infer<typeof OverviewDto>;
