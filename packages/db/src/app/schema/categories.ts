import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { money, poolId } from '../../columns';

// Categories (ADR 0004). The defaults are a global catalogue: rows with `pool_id` null and a
// `system_key`, named through i18n, written by migrations only. A category a family creates has
// `pool_id` and a `name`. RLS lets every pool read the global rows but only write its own (separate
// policies per command, see the migration: one `FOR ALL` policy would let a pool turn a global row
// into its own by an UPDATE).
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey(),
    poolId: uuid('pool_id'),
    systemKey: text('system_key'),
    name: text('name'),
    kind: text('kind').notNull(),
    color: text('color').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('categories_pool_idx').on(table.poolId),
    uniqueIndex('categories_system_key_uniq')
      .on(table.systemKey)
      .where(sql`${table.poolId} is null`),
    uniqueIndex('categories_pool_name_uniq')
      .on(table.poolId, table.name)
      .where(sql`${table.poolId} is not null`),
    check(
      'categories_scope',
      sql`(${table.poolId} is null and ${table.systemKey} is not null and ${table.name} is null) or (${table.poolId} is not null and ${table.name} is not null and ${table.systemKey} is null)`,
    ),
    check(
      'categories_kind',
      sql`${table.kind} in ('expense', 'income', 'refund', 'transfer', 'invest')`,
    ),
    check('categories_color_hex', sql`${table.color} ~ '^#[0-9A-Fa-f]{6}$'`),
    check(
      'categories_name_len',
      sql`${table.name} is null or char_length(${table.name}) between 1 and 60`,
    ),
    check('categories_system_key_format', sql`${table.systemKey} ~ '^[a-z][a-z0-9-]{1,39}$'`),
  ],
);

// What a pool decides about any category it can see, its own or global: the monthly budget (EUR),
// a colour of its own and whether it is hidden. One row per pool and category.
export const poolCategorySettings = pgTable(
  'pool_category_settings',
  {
    poolId: poolId(),
    categoryId: uuid('category_id').notNull(),
    monthlyBudget: money('monthly_budget'),
    colorOverride: text('color_override'),
    hidden: boolean('hidden').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.poolId, table.categoryId] }),
    check('pool_category_settings_budget', sql`${table.monthlyBudget} >= 0`),
    check(
      'pool_category_settings_color_hex',
      sql`${table.colorOverride} is null or ${table.colorOverride} ~ '^#[0-9A-Fa-f]{6}$'`,
    ),
    // A plain foreign key: a global category has no pool, so `(pool_id, id)` cannot be used. The
    // service reads the category through RLS before writing, so a pool cannot point at another's.
    foreignKey({
      name: 'pool_category_settings_category_fk',
      columns: [table.categoryId],
      foreignColumns: [categories.id],
    }).onDelete('cascade'),
  ],
);

export type CategoryRow = typeof categories.$inferSelect;
export type CategorySettingsRow = typeof poolCategorySettings.$inferSelect;
