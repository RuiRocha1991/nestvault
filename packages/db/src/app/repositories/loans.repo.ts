import { and, asc, eq, inArray } from 'drizzle-orm';

import type { PoolContext } from '../../pool-context';
import type { PoolTx } from '../client';
import {
  loanFields,
  loanInstallmentAmounts,
  loanInstallments,
  loans,
  type LoanFieldRow,
  type LoanInstallmentAmountRow,
  type LoanInstallmentRow,
  type LoanRow,
} from '../schema/loans';

export type { LoanFieldRow, LoanInstallmentAmountRow, LoanInstallmentRow, LoanRow };

export interface LoanValues {
  name: string;
  kind: string;
  propertyId: string | null;
  principal: string;
  startDate: string;
  firstDueDate: string;
  termMonths: number;
  rateType: string;
  rateIndex: string | null;
  spread: string | null;
  annualRate: string;
  fixedUntil: string | null;
  reviewMonths: number | null;
  paymentDay: number;
  debitAccountId: string | null;
  taeg: string | null;
  tan: string | null;
}

export interface LoanFieldValues {
  key: string;
  label: string;
  kind: string;
  enabled: boolean;
  countsAsExpense: boolean;
  defaultAmount: string | null;
  appliesFrom: string | null;
}

export interface InstallmentValues {
  number: number;
  dueDate: string;
  capital: string;
  interest: string;
  fees: string;
  stampTax: string;
  lifeInsurance: string;
  homeInsurance: string;
  creditInsurance: string;
  status: string;
  source: string;
}

/** Loans, their fields and installments. Every function filters by `ctx.poolId` (RLS repeats it). */
export const loansRepo = {
  async list(tx: PoolTx, ctx: PoolContext): Promise<LoanRow[]> {
    return tx
      .select()
      .from(loans)
      .where(eq(loans.poolId, ctx.poolId))
      .orderBy(asc(loans.createdAt), asc(loans.id));
  },

  async find(tx: PoolTx, ctx: PoolContext, id: string): Promise<LoanRow | undefined> {
    const [row] = await tx
      .select()
      .from(loans)
      .where(and(eq(loans.poolId, ctx.poolId), eq(loans.id, id)));
    return row;
  },

  async insert(tx: PoolTx, ctx: PoolContext, id: string, data: LoanValues): Promise<LoanRow> {
    const [row] = await tx
      .insert(loans)
      .values({ id, poolId: ctx.poolId, ...data })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  async update(
    tx: PoolTx,
    ctx: PoolContext,
    id: string,
    data: LoanValues,
  ): Promise<LoanRow | undefined> {
    const [row] = await tx
      .update(loans)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(loans.poolId, ctx.poolId), eq(loans.id, id)))
      .returning();
    return row;
  },

  /** Deletes the loan; its fields and installments go with it. */
  async remove(tx: PoolTx, ctx: PoolContext, id: string): Promise<boolean> {
    const rows = await tx
      .delete(loans)
      .where(and(eq(loans.poolId, ctx.poolId), eq(loans.id, id)))
      .returning({ id: loans.id });
    return rows.length > 0;
  },

  /** How many loans point at a property (the property cannot be deleted while there are any). */
  async countForProperty(tx: PoolTx, ctx: PoolContext, propertyId: string): Promise<number> {
    const rows = await tx
      .select({ id: loans.id })
      .from(loans)
      .where(and(eq(loans.poolId, ctx.poolId), eq(loans.propertyId, propertyId)));
    return rows.length;
  },

  /** How many loans are paid from an account. */
  async countForAccount(tx: PoolTx, ctx: PoolContext, accountId: string): Promise<number> {
    const rows = await tx
      .select({ id: loans.id })
      .from(loans)
      .where(and(eq(loans.poolId, ctx.poolId), eq(loans.debitAccountId, accountId)));
    return rows.length;
  },

  async listFields(
    tx: PoolTx,
    ctx: PoolContext,
    loanIds?: readonly string[],
  ): Promise<LoanFieldRow[]> {
    if (loanIds && loanIds.length === 0) return [];
    return tx
      .select()
      .from(loanFields)
      .where(
        and(
          eq(loanFields.poolId, ctx.poolId),
          loanIds ? inArray(loanFields.loanId, [...loanIds]) : undefined,
        ),
      )
      .orderBy(asc(loanFields.loanId), asc(loanFields.kind), asc(loanFields.key));
  },

  async insertFields(
    tx: PoolTx,
    ctx: PoolContext,
    loanId: string,
    fields: readonly (LoanFieldValues & { id: string })[],
  ): Promise<void> {
    if (fields.length === 0) return;
    await tx
      .insert(loanFields)
      .values(fields.map((field) => ({ ...field, poolId: ctx.poolId, loanId })));
  },

  async updateField(
    tx: PoolTx,
    ctx: PoolContext,
    loanId: string,
    key: string,
    data: Omit<LoanFieldValues, 'key' | 'kind'>,
  ): Promise<LoanFieldRow | undefined> {
    const [row] = await tx
      .update(loanFields)
      .set(data)
      .where(
        and(
          eq(loanFields.poolId, ctx.poolId),
          eq(loanFields.loanId, loanId),
          eq(loanFields.key, key),
        ),
      )
      .returning();
    return row;
  },

  async listInstallments(
    tx: PoolTx,
    ctx: PoolContext,
    loanId: string,
  ): Promise<LoanInstallmentRow[]> {
    return tx
      .select()
      .from(loanInstallments)
      .where(and(eq(loanInstallments.poolId, ctx.poolId), eq(loanInstallments.loanId, loanId)))
      .orderBy(asc(loanInstallments.number));
  },

  async findInstallment(
    tx: PoolTx,
    ctx: PoolContext,
    loanId: string,
    id: string,
  ): Promise<LoanInstallmentRow | undefined> {
    const [row] = await tx
      .select()
      .from(loanInstallments)
      .where(
        and(
          eq(loanInstallments.poolId, ctx.poolId),
          eq(loanInstallments.loanId, loanId),
          eq(loanInstallments.id, id),
        ),
      );
    return row;
  },

  async insertInstallment(
    tx: PoolTx,
    ctx: PoolContext,
    loanId: string,
    id: string,
    data: InstallmentValues,
  ): Promise<LoanInstallmentRow> {
    const [row] = await tx
      .insert(loanInstallments)
      .values({ id, poolId: ctx.poolId, loanId, ...data })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  },

  async updateInstallment(
    tx: PoolTx,
    ctx: PoolContext,
    loanId: string,
    id: string,
    data: InstallmentValues,
  ): Promise<LoanInstallmentRow | undefined> {
    const [row] = await tx
      .update(loanInstallments)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(loanInstallments.poolId, ctx.poolId),
          eq(loanInstallments.loanId, loanId),
          eq(loanInstallments.id, id),
        ),
      )
      .returning();
    return row;
  },

  async removeInstallment(
    tx: PoolTx,
    ctx: PoolContext,
    loanId: string,
    id: string,
  ): Promise<boolean> {
    const rows = await tx
      .delete(loanInstallments)
      .where(
        and(
          eq(loanInstallments.poolId, ctx.poolId),
          eq(loanInstallments.loanId, loanId),
          eq(loanInstallments.id, id),
        ),
      )
      .returning({ id: loanInstallments.id });
    return rows.length > 0;
  },

  /** The custom-field amounts of the given installments. */
  async listAmounts(
    tx: PoolTx,
    ctx: PoolContext,
    installmentIds: readonly string[],
  ): Promise<LoanInstallmentAmountRow[]> {
    if (installmentIds.length === 0) return [];
    return tx
      .select()
      .from(loanInstallmentAmounts)
      .where(
        and(
          eq(loanInstallmentAmounts.poolId, ctx.poolId),
          inArray(loanInstallmentAmounts.installmentId, [...installmentIds]),
        ),
      );
  },

  /** Replaces the custom-field amounts of an installment. */
  async replaceAmounts(
    tx: PoolTx,
    ctx: PoolContext,
    installmentId: string,
    amounts: readonly { fieldId: string; amount: string }[],
  ): Promise<void> {
    await tx
      .delete(loanInstallmentAmounts)
      .where(
        and(
          eq(loanInstallmentAmounts.poolId, ctx.poolId),
          eq(loanInstallmentAmounts.installmentId, installmentId),
        ),
      );
    if (amounts.length === 0) return;
    await tx
      .insert(loanInstallmentAmounts)
      .values(amounts.map((item) => ({ poolId: ctx.poolId, installmentId, ...item })));
  },
};
