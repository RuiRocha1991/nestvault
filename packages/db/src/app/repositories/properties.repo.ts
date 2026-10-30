import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { newId } from '../../ids';
import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import {
  properties,
  propertyHolders,
  propertyValuations,
  type PropertyHolderRow,
  type PropertyRow,
  type PropertyValuationRow,
} from '../schema/properties';

export type { PropertyHolderRow, PropertyRow, PropertyValuationRow };

export interface PropertyValues {
  name: string;
  type: string;
  address: string | null;
  purchaseDate: string;
  purchasePrice: string;
  downPayment: string;
  deedCost: string;
  imt: string;
  stampDuty: string;
  registrationCost: string;
  bankFees: string;
  sellingCostPct: string | null;
  includeInNetWorth: boolean;
}

export interface PropertyShare {
  holderId: string;
  sharePct: string;
}

export interface ValuationValues {
  date: string;
  value: string;
  source: string;
}

/** Properties, who owns them and what they are worth. Every function filters by `ctx.poolId` (RLS repeats it). */
export const propertiesRepo = {
  async list(tx: PoolTx, ctx: PoolContext): Promise<PropertyRow[]> {
    return tx
      .select()
      .from(properties)
      .where(eq(properties.poolId, ctx.poolId))
      .orderBy(asc(properties.createdAt), asc(properties.id));
  },

  async find(tx: PoolTx, ctx: PoolContext, id: string): Promise<PropertyRow | undefined> {
    const [row] = await tx
      .select()
      .from(properties)
      .where(and(eq(properties.poolId, ctx.poolId), eq(properties.id, id)));
    return row;
  },

  async insert(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: PropertyValues,
  ): Promise<PropertyRow> {
    const [row] = await tx
      .insert(properties)
      .values({
        id,
        poolId: ctx.poolId,
        name: data.name,
        type: data.type,
        address: data.address,
        purchaseDate: data.purchaseDate,
        purchasePrice: data.purchasePrice,
        downPayment: data.downPayment,
        deedCost: data.deedCost,
        imt: data.imt,
        stampDuty: data.stampDuty,
        registrationCost: data.registrationCost,
        bankFees: data.bankFees,
        sellingCostPct: data.sellingCostPct,
        includeInNetWorth: data.includeInNetWorth,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  async update(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: PropertyValues,
  ): Promise<PropertyRow | undefined> {
    const [row] = await tx
      .update(properties)
      .set({
        name: data.name,
        type: data.type,
        address: data.address,
        purchaseDate: data.purchaseDate,
        purchasePrice: data.purchasePrice,
        downPayment: data.downPayment,
        deedCost: data.deedCost,
        imt: data.imt,
        stampDuty: data.stampDuty,
        registrationCost: data.registrationCost,
        bankFees: data.bankFees,
        sellingCostPct: data.sellingCostPct,
        includeInNetWorth: data.includeInNetWorth,
        updatedAt: new Date(),
      })
      .where(and(eq(properties.poolId, ctx.poolId), eq(properties.id, id)))
      .returning();
    return row;
  },

  /** Deletes the property; its holders and valuations go with it. */
  async remove(tx: PoolTx, ctx: PoolContext, id: string): Promise<boolean> {
    const rows = await tx
      .delete(properties)
      .where(and(eq(properties.poolId, ctx.poolId), eq(properties.id, id)))
      .returning({ id: properties.id });
    return rows.length > 0;
  },

  /** The owners of the given properties (all of the pool's when none is given). */
  async listHolders(
    tx: PoolTx,
    ctx: PoolContext,
    propertyIds?: readonly string[],
  ): Promise<PropertyHolderRow[]> {
    if (propertyIds && propertyIds.length === 0) return [];
    return tx
      .select()
      .from(propertyHolders)
      .where(
        and(
          eq(propertyHolders.poolId, ctx.poolId),
          propertyIds ? inArray(propertyHolders.propertyId, [...propertyIds]) : undefined,
        ),
      )
      .orderBy(asc(propertyHolders.propertyId), asc(propertyHolders.holderId));
  },

  /** Replaces the owners of a property with the given shares. */
  async replaceHolders(
    tx: PoolTx,
    ctx: PoolContext,
    propertyId: string,
    shares: readonly PropertyShare[],
  ): Promise<void> {
    await tx
      .delete(propertyHolders)
      .where(
        and(eq(propertyHolders.poolId, ctx.poolId), eq(propertyHolders.propertyId, propertyId)),
      );
    if (shares.length === 0) return;
    await tx.insert(propertyHolders).values(
      shares.map((share) => ({
        poolId: ctx.poolId,
        propertyId,
        holderId: share.holderId,
        sharePct: share.sharePct,
      })),
    );
  },

  /** Valuations of the given properties, newest first (all of the pool's when none is given). */
  async listValuations(
    tx: PoolTx,
    ctx: PoolContext,
    propertyIds?: readonly string[],
  ): Promise<PropertyValuationRow[]> {
    if (propertyIds && propertyIds.length === 0) return [];
    return tx
      .select()
      .from(propertyValuations)
      .where(
        and(
          eq(propertyValuations.poolId, ctx.poolId),
          propertyIds ? inArray(propertyValuations.propertyId, [...propertyIds]) : undefined,
        ),
      )
      .orderBy(desc(propertyValuations.date), desc(propertyValuations.createdAt));
  },

  async insertValuation(
    tx: PoolTx,
    ctx: PoolContext,
    propertyId: string,
    data: ValuationValues,
  ): Promise<PropertyValuationRow> {
    const [row] = await tx
      .insert(propertyValuations)
      .values({
        id: newId(),
        poolId: ctx.poolId,
        propertyId,
        date: data.date,
        value: data.value,
        source: data.source,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  async removeValuation(
    tx: PoolTx,
    ctx: PoolContext,
    propertyId: string,
    id: string,
  ): Promise<boolean> {
    const rows = await tx
      .delete(propertyValuations)
      .where(
        and(
          eq(propertyValuations.poolId, ctx.poolId),
          eq(propertyValuations.propertyId, propertyId),
          eq(propertyValuations.id, id),
        ),
      )
      .returning({ id: propertyValuations.id });
    return rows.length > 0;
  },
};
