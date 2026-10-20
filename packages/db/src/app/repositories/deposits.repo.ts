import { and, asc, count, eq, or } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import { deposits, type DepositRow } from '../schema/savings';

export type { DepositRow };

export interface DepositValues {
  productId: string | null;
  capital: string;
  start: string;
  rate: string;
  payN: number | null;
  payU: string | null;
  termN: number | null;
  termU: string | null;
  capitalize: boolean;
  tax: string | null;
  payToAccountId: string | null;
  fundFromAccountId: string | null;
}

/** Term deposits (one per account). Every function filters by `ctx.poolId` (and RLS repeats it). */
export const depositsRepo = {
  async list(tx: PoolTx, ctx: PoolContext): Promise<DepositRow[]> {
    return tx
      .select()
      .from(deposits)
      .where(eq(deposits.poolId, ctx.poolId))
      .orderBy(asc(deposits.start), asc(deposits.id));
  },

  async find(tx: PoolTx, ctx: PoolContext, id: string): Promise<DepositRow | undefined> {
    const [row] = await tx
      .select()
      .from(deposits)
      .where(and(eq(deposits.poolId, ctx.poolId), eq(deposits.id, id)));
    return row;
  },

  async findByAccount(
    tx: PoolTx,
    ctx: PoolContext,
    accountId: string,
  ): Promise<DepositRow | undefined> {
    const [row] = await tx
      .select()
      .from(deposits)
      .where(and(eq(deposits.poolId, ctx.poolId), eq(deposits.accountId, accountId)));
    return row;
  },

  async insert(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    accountId: string,
    data: DepositValues,
  ): Promise<DepositRow> {
    const [row] = await tx
      .insert(deposits)
      .values({ id, poolId: ctx.poolId, accountId, ...fields(data) })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  /** Replaces the editable fields (not the account). `undefined` when not in this pool. */
  async update(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: DepositValues,
  ): Promise<DepositRow | undefined> {
    const [row] = await tx
      .update(deposits)
      .set({ ...fields(data), updatedAt: new Date() })
      .where(and(eq(deposits.poolId, ctx.poolId), eq(deposits.id, id)))
      .returning();
    return row;
  },

  async remove(tx: PoolTx, ctx: PoolContext, id: string): Promise<boolean> {
    const rows = await tx
      .delete(deposits)
      .where(and(eq(deposits.poolId, ctx.poolId), eq(deposits.id, id)))
      .returning({ id: deposits.id });
    return rows.length > 0;
  },

  async countByProduct(tx: PoolTx, ctx: PoolContext, productId: string): Promise<number> {
    const [row] = await tx
      .select({ n: count() })
      .from(deposits)
      .where(and(eq(deposits.poolId, ctx.poolId), eq(deposits.productId, productId)));
    return row?.n ?? 0;
  },

  /** How many deposits name this account as where interest goes or where the money comes from. */
  async countByFundingAccount(tx: PoolTx, ctx: PoolContext, accountId: string): Promise<number> {
    const [row] = await tx
      .select({ n: count() })
      .from(deposits)
      .where(
        and(
          eq(deposits.poolId, ctx.poolId),
          or(eq(deposits.payToAccountId, accountId), eq(deposits.fundFromAccountId, accountId)),
        ),
      );
    return row?.n ?? 0;
  },
};

/** The editable columns, field by field: the pool, the id and the account never come from here. */
function fields(data: DepositValues) {
  return {
    productId: data.productId,
    capital: data.capital,
    start: data.start,
    rate: data.rate,
    payN: data.payN,
    payU: data.payU,
    termN: data.termN,
    termU: data.termU,
    capitalize: data.capitalize,
    tax: data.tax,
    payToAccountId: data.payToAccountId,
    fundFromAccountId: data.fundFromAccountId,
  };
}
