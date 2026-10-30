import { and, asc, eq, inArray } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import {
  worksPayments,
  worksProjects,
  type WorksPaymentRow,
  type WorksProjectRow,
} from '../schema/works';

export type { WorksPaymentRow, WorksProjectRow };

export interface WorksProjectValues {
  propertyId: string;
  name: string;
  description: string | null;
  supplier: string | null;
  budget: string;
  depositPct: string | null;
  status: string;
  startDate: string | null;
  plannedEnd: string | null;
  notes: string | null;
}

export interface WorksPaymentValues {
  description: string;
  amount: string;
  plannedDate: string | null;
  paidDate: string | null;
  status: string;
}

/** Works projects and their payment phases. Every function filters by `ctx.poolId` (RLS repeats it). */
export const worksRepo = {
  /** The projects of the pool, or of one property, oldest first. */
  async listProjects(
    tx: PoolTx,
    ctx: PoolContext,
    propertyId?: string,
  ): Promise<WorksProjectRow[]> {
    return tx
      .select()
      .from(worksProjects)
      .where(
        and(
          eq(worksProjects.poolId, ctx.poolId),
          propertyId ? eq(worksProjects.propertyId, propertyId) : undefined,
        ),
      )
      .orderBy(asc(worksProjects.createdAt), asc(worksProjects.id));
  },

  async findProject(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
  ): Promise<WorksProjectRow | undefined> {
    const [row] = await tx
      .select()
      .from(worksProjects)
      .where(and(eq(worksProjects.poolId, ctx.poolId), eq(worksProjects.id, id)));
    return row;
  },

  async insertProject(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: WorksProjectValues,
  ): Promise<WorksProjectRow> {
    const [row] = await tx
      .insert(worksProjects)
      .values({ id, poolId: ctx.poolId, ...data })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  async updateProject(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: WorksProjectValues,
  ): Promise<WorksProjectRow | undefined> {
    const [row] = await tx
      .update(worksProjects)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(worksProjects.poolId, ctx.poolId), eq(worksProjects.id, id)))
      .returning();
    return row;
  },

  /** Deletes the project; its phases go with it. */
  async removeProject(tx: PoolTx, ctx: PoolContext, id: string): Promise<boolean> {
    const rows = await tx
      .delete(worksProjects)
      .where(and(eq(worksProjects.poolId, ctx.poolId), eq(worksProjects.id, id)))
      .returning({ id: worksProjects.id });
    return rows.length > 0;
  },

  /** The phases of the given projects (all of the pool's when none are given), by planned date. */
  async listPayments(
    tx: PoolTx,
    ctx: PoolContext,
    projectIds?: readonly string[],
  ): Promise<WorksPaymentRow[]> {
    if (projectIds && projectIds.length === 0) return [];
    return tx
      .select()
      .from(worksPayments)
      .where(
        and(
          eq(worksPayments.poolId, ctx.poolId),
          projectIds ? inArray(worksPayments.projectId, [...projectIds]) : undefined,
        ),
      )
      .orderBy(
        asc(worksPayments.projectId),
        asc(worksPayments.plannedDate),
        asc(worksPayments.createdAt),
        asc(worksPayments.id),
      );
  },

  async findPayment(
    tx: PoolTx,
    ctx: PoolContext,
    projectId: string,
    id: string,
  ): Promise<WorksPaymentRow | undefined> {
    const [row] = await tx
      .select()
      .from(worksPayments)
      .where(
        and(
          eq(worksPayments.poolId, ctx.poolId),
          eq(worksPayments.projectId, projectId),
          eq(worksPayments.id, id),
        ),
      );
    return row;
  },

  async insertPayment(
    tx: PoolTx,
    ctx: PoolContext,
    projectId: string,
    id: string,
    data: WorksPaymentValues,
  ): Promise<WorksPaymentRow> {
    const [row] = await tx
      .insert(worksPayments)
      .values({ id, poolId: ctx.poolId, projectId, ...data })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  async updatePayment(
    tx: PoolTx,
    ctx: PoolContext,
    projectId: string,
    id: string,
    data: WorksPaymentValues,
  ): Promise<WorksPaymentRow | undefined> {
    const [row] = await tx
      .update(worksPayments)
      .set(data)
      .where(
        and(
          eq(worksPayments.poolId, ctx.poolId),
          eq(worksPayments.projectId, projectId),
          eq(worksPayments.id, id),
        ),
      )
      .returning();
    return row;
  },

  /** Links a bank movement: the phase is paid on the movement's date. */
  async linkTransaction(
    tx: PoolTx,
    ctx: PoolContext,
    projectId: string,
    id: string,
    transactionId: string,
    paidDate: string,
  ): Promise<WorksPaymentRow | undefined> {
    const [row] = await tx
      .update(worksPayments)
      .set({ transactionId, paidDate, status: 'paid' })
      .where(
        and(
          eq(worksPayments.poolId, ctx.poolId),
          eq(worksPayments.projectId, projectId),
          eq(worksPayments.id, id),
        ),
      )
      .returning();
    return row;
  },

  /** Removes the link; the phase goes back to planned. */
  async unlinkTransaction(
    tx: PoolTx,
    ctx: PoolContext,
    projectId: string,
    id: string,
  ): Promise<WorksPaymentRow | undefined> {
    const [row] = await tx
      .update(worksPayments)
      .set({ transactionId: null, paidDate: null, status: 'planned' })
      .where(
        and(
          eq(worksPayments.poolId, ctx.poolId),
          eq(worksPayments.projectId, projectId),
          eq(worksPayments.id, id),
        ),
      )
      .returning();
    return row;
  },

  async removePayment(
    tx: PoolTx,
    ctx: PoolContext,
    projectId: string,
    id: string,
  ): Promise<boolean> {
    const rows = await tx
      .delete(worksPayments)
      .where(
        and(
          eq(worksPayments.poolId, ctx.poolId),
          eq(worksPayments.projectId, projectId),
          eq(worksPayments.id, id),
        ),
      )
      .returning({ id: worksPayments.id });
    return rows.length > 0;
  },
};
