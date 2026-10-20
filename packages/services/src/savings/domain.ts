import type { DepositRow, InterestEntryRow, PoolContext, PoolTx } from '@nestvault/db';
import { depositsRepo, interestEntriesRepo } from '@nestvault/db';
import type { Deposit, ManualInterestEntry, PeriodUnit } from '@nestvault/domain';

/** A deposit row as the domain reads it: its id is the id of the account it belongs to. */
export const toDomainDeposit = (row: DepositRow): Deposit => ({
  id: row.accountId,
  capital: row.capital,
  rate: row.rate,
  start: row.start,
  payN: row.payN,
  payU: row.payU as PeriodUnit | null,
  termN: row.termN,
  termU: row.termU as PeriodUnit | null,
  capitalize: row.capitalize,
  tax: row.tax,
  payTo: row.payToAccountId,
  fundFrom: row.fundFromAccountId,
});

export const toManualInterest = (row: InterestEntryRow): ManualInterestEntry => ({
  id: row.id,
  accountId: row.accountId,
  date: row.date,
  amount: row.amount,
});

/** What the balance engine needs from the savings module: deposits by account and the entries. */
export interface SavingsLedger {
  deposits: Map<string, Deposit>;
  interestEntries: ManualInterestEntry[];
}

export async function loadSavingsLedger(tx: PoolTx, ctx: PoolContext): Promise<SavingsLedger> {
  const [depositRows, entryRows] = await Promise.all([
    depositsRepo.list(tx, ctx),
    interestEntriesRepo.list(tx, ctx),
  ]);
  return {
    deposits: new Map(depositRows.map((row) => [row.accountId, toDomainDeposit(row)])),
    interestEntries: entryRows.map(toManualInterest),
  };
}
