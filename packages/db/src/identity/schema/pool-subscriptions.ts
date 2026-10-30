import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { pools } from './pools';

/** Plans a pool can be on; no row for a pool means Free (ADR 0003). */
export const PLANS = ['free', 'pro'] as const;
export type Plan = (typeof PLANS)[number];

export const SUBSCRIPTION_STATUSES = ['active', 'past_due', 'canceled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

// The subscription of a pool (ADR 0003). The plan belongs to the pool, not to a user. Billing is off
// for now, so nothing writes here yet; the provider columns are for the Stripe integration later.
export const poolSubscriptions = pgTable(
  'pool_subscriptions',
  {
    poolId: uuid('pool_id')
      .primaryKey()
      .references(() => pools.id, { onDelete: 'cascade' }),
    plan: text('plan').notNull(),
    status: text('status').notNull().default('active'),
    provider: text('provider'),
    providerCustomerId: text('provider_customer_id'),
    providerSubscriptionId: text('provider_subscription_id'),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAt: timestamp('cancel_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('pool_subscriptions_plan_check', sql`${table.plan} in ('free', 'pro')`),
    check(
      'pool_subscriptions_status_check',
      sql`${table.status} in ('active', 'past_due', 'canceled')`,
    ),
  ],
);

export type PoolSubscriptionRow = typeof poolSubscriptions.$inferSelect;
