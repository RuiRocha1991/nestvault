import { and, asc, eq, inArray } from 'drizzle-orm';

import { newId } from '../../ids';
import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import { goalScopes, goals, type GoalRow, type GoalScopeRow } from '../schema/goals';

export type { GoalRow, GoalScopeRow };

export interface GoalValues {
  name: string;
  color: string;
  type: string;
  target: string;
  mode: string;
  deadline: string | null;
  monthly: string | null;
  rate: string | null;
  yield: string | null;
  includeSavings: boolean;
}

/** What a goal counts: portfolios, or accounts (and sub-accounts of them). */
export interface GoalScopeValue {
  portfolioId: string | null;
  accountId: string | null;
  subAccountId: string | null;
}

/** Goals and their scopes. Every function filters by `ctx.poolId` (and RLS repeats it). */
export const goalsRepo = {
  async list(tx: PoolTx, ctx: PoolContext): Promise<GoalRow[]> {
    return tx
      .select()
      .from(goals)
      .where(eq(goals.poolId, ctx.poolId))
      .orderBy(asc(goals.createdAt), asc(goals.id));
  },

  async find(tx: PoolTx, ctx: PoolContext, id: string): Promise<GoalRow | undefined> {
    const [row] = await tx
      .select()
      .from(goals)
      .where(and(eq(goals.poolId, ctx.poolId), eq(goals.id, id)));
    return row;
  },

  /** The scopes of the given goals (all of the pool's goals when none is given). */
  async listScopes(
    tx: PoolTx,
    ctx: PoolContext,
    goalIds?: readonly string[],
  ): Promise<GoalScopeRow[]> {
    if (goalIds && goalIds.length === 0) return [];
    return tx
      .select()
      .from(goalScopes)
      .where(
        and(
          eq(goalScopes.poolId, ctx.poolId),
          goalIds ? inArray(goalScopes.goalId, [...goalIds]) : undefined,
        ),
      )
      .orderBy(asc(goalScopes.id));
  },

  async insert(tx: PoolTx, ctx: PoolContext, id: string, data: GoalValues): Promise<GoalRow> {
    const [row] = await tx
      .insert(goals)
      .values({
        id,
        poolId: ctx.poolId,
        name: data.name,
        color: data.color,
        type: data.type,
        target: data.target,
        mode: data.mode,
        deadline: data.deadline,
        monthly: data.monthly,
        rate: data.rate,
        yield: data.yield,
        includeSavings: data.includeSavings,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  async update(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: GoalValues,
  ): Promise<GoalRow | undefined> {
    const [row] = await tx
      .update(goals)
      .set({
        name: data.name,
        color: data.color,
        type: data.type,
        target: data.target,
        mode: data.mode,
        deadline: data.deadline,
        monthly: data.monthly,
        rate: data.rate,
        yield: data.yield,
        includeSavings: data.includeSavings,
        updatedAt: new Date(),
      })
      .where(and(eq(goals.poolId, ctx.poolId), eq(goals.id, id)))
      .returning();
    return row;
  },

  /** Replaces the scopes of a goal with the given ones. */
  async replaceScopes(
    tx: PoolTx,
    ctx: PoolContext,
    goalId: string,
    scopes: readonly GoalScopeValue[],
  ): Promise<void> {
    await tx
      .delete(goalScopes)
      .where(and(eq(goalScopes.poolId, ctx.poolId), eq(goalScopes.goalId, goalId)));
    if (scopes.length === 0) return;
    await tx.insert(goalScopes).values(
      scopes.map((scope) => ({
        id: newId(),
        poolId: ctx.poolId,
        goalId,
        portfolioId: scope.portfolioId,
        accountId: scope.accountId,
        subAccountId: scope.subAccountId,
      })),
    );
  },

  /** Deletes the goal; its scopes go with it. */
  async remove(tx: PoolTx, ctx: PoolContext, id: string): Promise<boolean> {
    const rows = await tx
      .delete(goals)
      .where(and(eq(goals.poolId, ctx.poolId), eq(goals.id, id)))
      .returning({ id: goals.id });
    return rows.length > 0;
  },
};
