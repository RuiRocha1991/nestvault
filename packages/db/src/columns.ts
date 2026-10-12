import { numeric, uuid } from 'drizzle-orm/pg-core';

// Column helpers shared by both databases. Numbers stay strings end to end: money, quantities
// and rates are never JS floats (architecture rule 6); arithmetic belongs to packages/domain.

/** Money: `numeric(18,4)`, read and written as a decimal string. */
export const money = (name: string) => numeric(name, { precision: 18, scale: 4 });

/** Quantities (units, shares): `numeric(20,8)`. */
export const quantity = (name: string) => numeric(name, { precision: 20, scale: 8 });

/** Rates and percentages: `numeric(9,6)`. */
export const rate = (name: string) => numeric(name, { precision: 9, scale: 6 });

/** `pool_id uuid not null`: the first column after `id` of every pool table in `nestvault_app`. */
export const poolId = () => uuid('pool_id').notNull();
