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

import { money, poolId, rate } from '../../columns';

import { accounts, subAccounts } from './accounts';
import { portfolios } from './portfolios';

export const GOAL_TYPES = ['value', 'invested', 'income', 'contrib'] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

/** `date` = deadline, `eta` = compute when it is reached, `none` = just track. */
export const GOAL_MODES = ['date', 'eta', 'none'] as const;
export type GoalMode = (typeof GOAL_MODES)[number];

// A goal (PRD 04, "Goals"). `target` is in EUR; for `income` it is a yearly income and for `contrib`
// the amount bought in the deadline's year. What it counts (portfolios, accounts) lives in
// `goal_scopes`. The calculation is in packages/domain (`goalCalc`); nothing derived is stored.
export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    name: text('name').notNull(),
    color: text('color').notNull(),
    type: text('type').notNull(),
    target: money('target').notNull(),
    mode: text('mode').notNull().default('date'),
    deadline: date('deadline', { mode: 'string' }),
    monthly: money('monthly'),
    rate: rate('rate'),
    yield: rate('yield'),
    includeSavings: boolean('include_savings').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('goals_pool_idx').on(table.poolId),
    unique('goals_pool_id_uniq').on(table.poolId, table.id),
    check('goals_name_len', sql`char_length(${table.name}) between 1 and 60`),
    check('goals_color_format', sql`${table.color} ~ '^#[0-9a-fA-F]{6}$'`),
    check('goals_type_known', sql`${table.type} in ('value', 'invested', 'income', 'contrib')`),
    check('goals_mode_known', sql`${table.mode} in ('date', 'eta', 'none')`),
    check('goals_target_positive', sql`${table.target} > 0`),
    check('goals_monthly_not_negative', sql`${table.monthly} is null or ${table.monthly} >= 0`),
    check('goals_rate_range', sql`${table.rate} is null or ${table.rate} between 0 and 100`),
    check('goals_yield_range', sql`${table.yield} is null or ${table.yield} between 0 and 100`),
    // A deadline is what `date` mode and the `contrib` type are about.
    check('goals_deadline_needed', sql`${table.mode} <> 'date' or ${table.deadline} is not null`),
  ],
);

// What a goal counts: a portfolio, a whole account, or one sub-account. No row = everything.
// Exactly one kind per row; when any account row exists the goal ignores its portfolio rows
// (the domain's `goalKeys`).
export const goalScopes = pgTable(
  'goal_scopes',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    goalId: uuid('goal_id').notNull(),
    portfolioId: uuid('portfolio_id'),
    accountId: uuid('account_id'),
    subAccountId: uuid('sub_account_id'),
  },
  (table) => [
    index('goal_scopes_pool_goal_idx').on(table.poolId, table.goalId),
    check(
      'goal_scopes_one_kind',
      sql`(${table.portfolioId} is not null and ${table.accountId} is null and ${table.subAccountId} is null)
        or (${table.portfolioId} is null and ${table.accountId} is not null)`,
    ),
    foreignKey({
      name: 'goal_scopes_goal_fk',
      columns: [table.poolId, table.goalId],
      foreignColumns: [goals.poolId, goals.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'goal_scopes_portfolio_fk',
      columns: [table.poolId, table.portfolioId],
      foreignColumns: [portfolios.poolId, portfolios.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'goal_scopes_account_fk',
      columns: [table.poolId, table.accountId],
      foreignColumns: [accounts.poolId, accounts.id],
    }).onDelete('cascade'),
    // The sub-account must belong to the scope's account (MATCH SIMPLE: skipped when null).
    foreignKey({
      name: 'goal_scopes_sub_account_fk',
      columns: [table.poolId, table.accountId, table.subAccountId],
      foreignColumns: [subAccounts.poolId, subAccounts.accountId, subAccounts.id],
    }).onDelete('cascade'),
  ],
);

export type GoalRow = typeof goals.$inferSelect;
export type GoalScopeRow = typeof goalScopes.$inferSelect;
