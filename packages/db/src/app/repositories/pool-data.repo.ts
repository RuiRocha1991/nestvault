import { sql } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';

/** How much financial data a pool already holds (what a prototype import must not meet). */
export interface PoolDataCounts {
  accounts: number;
  transactions: number;
  portfolios: number;
  assets: number;
  savingsProducts: number;
  rules: number;
  ownCategories: number;
  investmentOps: number;
  plans: number;
  cashMoves: number;
  interestEntries: number;
  goals: number;
  properties: number;
  loans: number;
}

/**
 * Counts per table for the emptiness check of the prototype import (NES-47). One statement; the
 * pool is bound as a parameter and RLS repeats the filter. Month notes, holders and settings are
 * deliberately not counted: an import leaves them as they are.
 */
export const poolDataRepo = {
  async counts(tx: PoolTx, ctx: PoolContext): Promise<PoolDataCounts> {
    const result = await tx.execute<Record<keyof PoolDataCounts, number>>(sql`
      select
        (select count(*)::int from accounts where pool_id = ${ctx.poolId}) as "accounts",
        (select count(*)::int from transactions where pool_id = ${ctx.poolId}) as "transactions",
        (select count(*)::int from portfolios where pool_id = ${ctx.poolId}) as "portfolios",
        (select count(*)::int from assets where pool_id = ${ctx.poolId}) as "assets",
        (select count(*)::int from savings_products where pool_id = ${ctx.poolId}) as "savingsProducts",
        (select count(*)::int from category_rules where pool_id = ${ctx.poolId}) as "rules",
        (select count(*)::int from categories where pool_id = ${ctx.poolId}) as "ownCategories",
        (select count(*)::int from investment_ops where pool_id = ${ctx.poolId}) as "investmentOps",
        (select count(*)::int from plans where pool_id = ${ctx.poolId}) as "plans",
        (select count(*)::int from portfolio_cash_moves where pool_id = ${ctx.poolId}) as "cashMoves",
        (select count(*)::int from interest_entries where pool_id = ${ctx.poolId}) as "interestEntries",
        (select count(*)::int from goals where pool_id = ${ctx.poolId}) as "goals",
        (select count(*)::int from properties where pool_id = ${ctx.poolId}) as "properties",
        (select count(*)::int from loans where pool_id = ${ctx.poolId}) as "loans"
    `);
    const row = result.rows[0];
    if (!row) throw new Error('count returned no row');
    return row;
  },

  /**
   * Serializes imports into one pool for the length of the transaction: a second import waits for
   * the first and then finds the pool no longer empty.
   */
  async lockForImport(tx: PoolTx, ctx: PoolContext): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ctx.poolId}, 47))`);
  },
};
