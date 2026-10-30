import {
  loanEventsRepo,
  loansRepo,
  propertiesRepo,
  type PoolContext,
  type PoolTx,
} from '@nestvault/db';
import {
  installmentCostSplit,
  sum,
  type InstallmentSplit,
  type LoanLiability,
  type PropertyWorth,
  type RealEstateData,
} from '@nestvault/domain';

import { toAmounts } from '../loans/schemas';

export interface RealEstateLedger {
  /** Properties and loans for net worth; `undefined` when the pool has neither. */
  realEstate: RealEstateData | undefined;
  /** The split of every installment, by installment id: what a linked debit counts as. */
  splits: ReadonlyMap<string, InstallmentSplit>;
}

/**
 * What the pool's net worth and expenses read about real estate (NES-100), loaded once: the
 * properties with their share and valuations, the loans with their installments and prepayments,
 * and the expense split of each installment. One call serves the overview, the month review and
 * the expenses screen, so they all show the same numbers.
 */
export async function loadRealEstateLedger(
  tx: PoolTx,
  ctx: PoolContext,
): Promise<RealEstateLedger> {
  const [propertyRows, holderRows, valuationRows, loanRows, installmentRows, fieldRows, prepaid] =
    await Promise.all([
      propertiesRepo.list(tx, ctx),
      propertiesRepo.listHolders(tx, ctx),
      propertiesRepo.listValuations(tx, ctx),
      loansRepo.list(tx, ctx),
      loansRepo.listAllInstallments(tx, ctx),
      loansRepo.listFields(tx, ctx),
      loanEventsRepo.listPrepayments(tx, ctx),
    ]);
  if (propertyRows.length === 0 && loanRows.length === 0) {
    return { realEstate: undefined, splits: new Map() };
  }
  const customRows = await loansRepo.listAmounts(
    tx,
    ctx,
    installmentRows.map((row) => row.id),
  );

  const properties = new Map<string, PropertyWorth>(
    propertyRows.map((row) => [
      row.id,
      {
        purchaseDate: row.purchaseDate,
        purchasePrice: row.purchasePrice,
        sharePct: sum(
          holderRows.filter((holder) => holder.propertyId === row.id).map((h) => h.sharePct),
        ),
        includeInNetWorth: row.includeInNetWorth,
        valuations: valuationRows
          .filter((valuation) => valuation.propertyId === row.id)
          .map((valuation) => ({ date: valuation.date, value: valuation.value })),
      },
    ]),
  );
  const loans: LoanLiability[] = loanRows.map((row) => ({
    propertyId: row.propertyId,
    startDate: row.startDate,
    principal: row.principal,
    installments: installmentRows
      .filter((item) => item.loanId === row.id)
      .map((item) => ({ dueDate: item.dueDate, capital: item.capital })),
    prepayments: prepaid
      .filter((item) => item.loanId === row.id)
      .map((item) => ({ date: item.date, amount: item.amount })),
  }));

  const splits = new Map<string, InstallmentSplit>();
  for (const row of installmentRows) {
    const fields = fieldRows.filter((field) => field.loanId === row.loanId);
    splits.set(
      row.id,
      installmentCostSplit(
        toAmounts(row, customRows, fields),
        fields.map((field) => ({
          key: field.key,
          enabled: field.enabled,
          countsAsExpense: field.countsAsExpense,
        })),
      ),
    );
  }
  return { realEstate: { properties, loans }, splits };
}

/** The transactions with the split of the installment each paid (the others are untouched). */
export function withInstallmentSplits<T extends { loanInstallmentId?: string | null }>(
  rows: readonly T[],
  splits: ReadonlyMap<string, InstallmentSplit>,
): (T & { installment?: InstallmentSplit })[] {
  if (splits.size === 0) return [...rows];
  return rows.map((row) => {
    const split = row.loanInstallmentId ? splits.get(row.loanInstallmentId) : undefined;
    return split ? { ...row, installment: split } : row;
  });
}


/** The installment split a debit counts as, if it paid one. */
export const installmentOf = (
  splits: ReadonlyMap<string, InstallmentSplit>,
  loanInstallmentId: string | null | undefined,
): { installment: InstallmentSplit } | Record<string, never> => {
  const split = loanInstallmentId ? splits.get(loanInstallmentId) : undefined;
  return split ? { installment: split } : {};
};
