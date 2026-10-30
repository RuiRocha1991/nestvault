import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { money, poolId, rate } from '../../columns';

import { holders } from './holders';

export const PROPERTY_TYPES = ['primary_home', 'secondary', 'rental', 'land', 'garage'] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const VALUATION_SOURCES = ['manual', 'bank_appraisal', 'estimate'] as const;
export type ValuationSource = (typeof VALUATION_SOURCES)[number];

// A property (PRD "Real estate and loans", Pro). The purchase data and the itemized acquisition
// costs are stored; what is derived (total costs, loan amount, equity) is computed in packages/domain.
// Loans, works and recurring costs point at a property in later tasks.
export const properties = pgTable(
  'properties',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    address: text('address'),
    purchaseDate: date('purchase_date', { mode: 'string' }).notNull(),
    purchasePrice: money('purchase_price').notNull(),
    downPayment: money('down_payment').notNull().default('0'),
    // Itemized acquisition costs (EUR): the deed, IMT, stamp duty, registration and bank fees.
    deedCost: money('deed_cost').notNull().default('0'),
    imt: money('imt').notNull().default('0'),
    stampDuty: money('stamp_duty').notNull().default('0'),
    registrationCost: money('registration_cost').notNull().default('0'),
    bankFees: money('bank_fees').notNull().default('0'),
    // What selling would cost, in percent of the price, for the sale analysis.
    sellingCostPct: rate('selling_cost_pct'),
    includeInNetWorth: boolean('include_in_net_worth').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('properties_pool_idx').on(table.poolId),
    unique('properties_pool_id_uniq').on(table.poolId, table.id),
    check('properties_name_len', sql`char_length(${table.name}) between 1 and 80`),
    check(
      'properties_type_known',
      sql`${table.type} in ('primary_home', 'secondary', 'rental', 'land', 'garage')`,
    ),
    check(
      'properties_address_len',
      sql`${table.address} is null or char_length(${table.address}) between 1 and 200`,
    ),
    check('properties_price_positive', sql`${table.purchasePrice} > 0`),
    check(
      'properties_down_payment_range',
      sql`${table.downPayment} >= 0 and ${table.downPayment} <= ${table.purchasePrice}`,
    ),
    check(
      'properties_costs_not_negative',
      sql`${table.deedCost} >= 0 and ${table.imt} >= 0 and ${table.stampDuty} >= 0
        and ${table.registrationCost} >= 0 and ${table.bankFees} >= 0`,
    ),
    check(
      'properties_selling_cost_range',
      sql`${table.sellingCostPct} is null or ${table.sellingCostPct} between 0 and 100`,
    ),
  ],
);

// Who owns the property and how much of it (percent). The shares of one property add up to 100: the
// service checks it in the same transaction that writes them. The holder is restricted, not
// cascaded: a person who still owns part of a property cannot be removed.
export const propertyHolders = pgTable(
  'property_holders',
  {
    poolId: poolId(),
    propertyId: uuid('property_id').notNull(),
    holderId: uuid('holder_id').notNull(),
    sharePct: rate('share_pct').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.propertyId, table.holderId] }),
    index('property_holders_pool_idx').on(table.poolId),
    index('property_holders_holder_idx').on(table.poolId, table.holderId),
    check('property_holders_share_range', sql`${table.sharePct} > 0 and ${table.sharePct} <= 100`),
    foreignKey({
      name: 'property_holders_property_fk',
      columns: [table.poolId, table.propertyId],
      foreignColumns: [properties.poolId, properties.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'property_holders_holder_fk',
      columns: [table.poolId, table.holderId],
      foreignColumns: [holders.poolId, holders.id],
    }).onDelete('restrict'),
  ],
);

// What the property is worth on a date. The newest date is the value used for net worth.
export const propertyValuations = pgTable(
  'property_valuations',
  {
    id: uuid('id').primaryKey(),
    poolId: poolId(),
    propertyId: uuid('property_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    value: money('value').notNull(),
    source: text('source').notNull().default('manual'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('property_valuations_pool_property_idx').on(table.poolId, table.propertyId, table.date),
    // One valuation per property and day: a correction is a delete and a new one.
    unique('property_valuations_day_uniq').on(table.poolId, table.propertyId, table.date),
    check('property_valuations_value_positive', sql`${table.value} > 0`),
    check(
      'property_valuations_source_known',
      sql`${table.source} in ('manual', 'bank_appraisal', 'estimate')`,
    ),
    foreignKey({
      name: 'property_valuations_property_fk',
      columns: [table.poolId, table.propertyId],
      foreignColumns: [properties.poolId, properties.id],
    }).onDelete('cascade'),
  ],
);

export type PropertyRow = typeof properties.$inferSelect;
export type PropertyHolderRow = typeof propertyHolders.$inferSelect;
export type PropertyValuationRow = typeof propertyValuations.$inferSelect;
