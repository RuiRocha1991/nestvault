import { and, asc, eq, inArray } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import {
  propertyCostPayments,
  propertyCosts,
  type PropertyCostPaymentRow,
  type PropertyCostRow,
} from '../schema/property-costs';

export type { PropertyCostPaymentRow, PropertyCostRow };

export interface PropertyCostValues {
  propertyId: string;
  kind: string;
  name: string | null;
  amount: string;
  periodicity: string;
  intervalMonths: number;
  startDate: string;
  endDate: string | null;
  accountId: string | null;
}

/** Recurring property costs and the occurrences a bank debit paid. Every function filters by `ctx.poolId` (RLS repeats it). */
export const propertyCostsRepo = {
  /** The costs of the pool, or of one property, oldest first. */
  async list(tx: PoolTx, ctx: PoolContext, propertyId?: string): Promise<PropertyCostRow[]> {
    return tx
      .select()
      .from(propertyCosts)
      .where(
        and(
          eq(propertyCosts.poolId, ctx.poolId),
          propertyId ? eq(propertyCosts.propertyId, propertyId) : undefined,
        ),
      )
      .orderBy(asc(propertyCosts.createdAt), asc(propertyCosts.id));
  },

  async find(tx: PoolTx, ctx: PoolContext, id: string): Promise<PropertyCostRow | undefined> {
    const [row] = await tx
      .select()
      .from(propertyCosts)
      .where(and(eq(propertyCosts.poolId, ctx.poolId), eq(propertyCosts.id, id)));
    return row;
  },

  async insert(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: PropertyCostValues,
  ): Promise<PropertyCostRow> {
    const [row] = await tx
      .insert(propertyCosts)
      .values({ id, poolId: ctx.poolId, ...data })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  async update(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: PropertyCostValues,
  ): Promise<PropertyCostRow | undefined> {
    const [row] = await tx
      .update(propertyCosts)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(propertyCosts.poolId, ctx.poolId), eq(propertyCosts.id, id)))
      .returning();
    return row;
  },

  /** Deletes the cost; the occurrences it paid go with it. */
  async remove(tx: PoolTx, ctx: PoolContext, id: string): Promise<boolean> {
    const rows = await tx
      .delete(propertyCosts)
      .where(and(eq(propertyCosts.poolId, ctx.poolId), eq(propertyCosts.id, id)))
      .returning({ id: propertyCosts.id });
    return rows.length > 0;
  },

  /** The paid occurrences of the given costs (all of the pool's when none are given), by due date. */
  async listPayments(
    tx: PoolTx,
    ctx: PoolContext,
    costIds?: readonly string[],
  ): Promise<PropertyCostPaymentRow[]> {
    if (costIds && costIds.length === 0) return [];
    return tx
      .select()
      .from(propertyCostPayments)
      .where(
        and(
          eq(propertyCostPayments.poolId, ctx.poolId),
          costIds ? inArray(propertyCostPayments.costId, [...costIds]) : undefined,
        ),
      )
      .orderBy(asc(propertyCostPayments.dueDate), asc(propertyCostPayments.id));
  },

  async findPayment(
    tx: PoolTx,
    ctx: PoolContext,
    costId: string,
    dueDate: string,
  ): Promise<PropertyCostPaymentRow | undefined> {
    const [row] = await tx
      .select()
      .from(propertyCostPayments)
      .where(
        and(
          eq(propertyCostPayments.poolId, ctx.poolId),
          eq(propertyCostPayments.costId, costId),
          eq(propertyCostPayments.dueDate, dueDate),
        ),
      );
    return row;
  },

  /** Marks an occurrence paid by a movement. A taken occurrence or movement fails with a unique violation. */
  async insertPayment(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    costId: string,
    dueDate: string,
    transactionId: string,
  ): Promise<PropertyCostPaymentRow> {
    const [row] = await tx
      .insert(propertyCostPayments)
      .values({ id, poolId: ctx.poolId, costId, dueDate, transactionId })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  async removePayment(
    tx: PoolTx,
    ctx: PoolContext,
    costId: string,
    dueDate: string,
  ): Promise<boolean> {
    const rows = await tx
      .delete(propertyCostPayments)
      .where(
        and(
          eq(propertyCostPayments.poolId, ctx.poolId),
          eq(propertyCostPayments.costId, costId),
          eq(propertyCostPayments.dueDate, dueDate),
        ),
      )
      .returning({ id: propertyCostPayments.id });
    return rows.length > 0;
  },
};
