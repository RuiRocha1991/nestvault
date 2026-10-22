import type { AccountRow } from '@nestvault/db';
import {
  accountBalancesAt,
  accountInterest,
  dec,
  interestTotal,
  monthEnd,
  sum,
  toEur,
  toPlain,
  type Deposit,
  type FxRates,
  type InvestmentAsset,
  type InvestmentOp,
  type ManualInterestEntry,
  type PortfolioCashMove,
  type Transaction,
} from '@nestvault/domain';

import { toLedgerAccount } from '../accounts/ledger';

/** What the linked accounts add to the performance chart in one month, in EUR. */
export interface AccountMonth {
  /** Their balances at the end of the month. */
  value: string;
  /** The interest they had earned by then (it is not money the family put in). */
  interest: string;
}

export interface AccountSeriesInput {
  accounts: readonly AccountRow[];
  deposits: ReadonlyMap<string, Deposit>;
  interestEntries: readonly ManualInterestEntry[];
  transactions: readonly Transaction[];
  ops: readonly InvestmentOp[];
  assets: readonly InvestmentAsset[];
  moves: readonly PortfolioCashMove[];
  rates: FxRates;
  defaultTax: string;
  /** `null` for "all portfolios": every account linked to any portfolio. */
  portfolioId: string | null;
  months: readonly string[];
  asOf: string;
}

/** The accounts linked to the scope: the ones whose balance the portfolio's summary counts. */
export const linkedAccounts = (accounts: readonly AccountRow[], portfolioId: string | null) =>
  accounts.filter((row) => (portfolioId ? row.portfolioId === portfolioId : !!row.portfolioId));

/** The first day any of the linked accounts has data (opening balance, deposit or movement). */
export function accountsFrom(
  input: Pick<AccountSeriesInput, 'accounts' | 'deposits' | 'transactions' | 'portfolioId'>,
): string | null {
  const linked = linkedAccounts(input.accounts, input.portfolioId);
  const ids = new Set(linked.map((row) => row.id));
  const dates = [
    ...linked.flatMap((row) => [row.openingDate, input.deposits.get(row.id)?.start ?? null]),
    ...input.transactions.filter((t) => ids.has(t.accountId)).map((t) => t.date),
  ].filter((date): date is string => !!date);
  return dates.length ? dates.reduce((first, date) => (date < first ? date : first)) : null;
}

/**
 * Month-end value and accrued interest of the accounts linked to a portfolio, like the
 * prototype's performance chart: value = positions + these balances, invested = cost + these
 * balances - their interest. A portfolio that holds only accounts (an emergency fund, works)
 * therefore has a history.
 */
export function accountSeries(input: AccountSeriesInput): Map<string, AccountMonth> {
  const linked = linkedAccounts(input.accounts, input.portfolioId);
  const result = new Map<string, AccountMonth>();
  if (linked.length === 0 || input.months.length === 0) return result;
  const ends = input.months.map((month) =>
    month === input.asOf.slice(0, 7) ? input.asOf : monthEnd(month),
  );
  const ids = new Set(linked.map((row) => row.id));
  const balances = accountBalancesAt(
    {
      accounts: linked.map((row) => toLedgerAccount(row, input.deposits.get(row.id))),
      transactions: input.transactions.filter((t) => ids.has(t.accountId)),
      interestEntries: input.interestEntries.filter((entry) => ids.has(entry.accountId)),
      ops: input.ops,
      assets: input.assets,
      moves: input.moves,
      categories: [],
      rates: input.rates,
      defaultTax: input.defaultTax,
    },
    ends,
  );
  input.months.forEach((month, index) => {
    const end = ends[index] as string;
    const at = balances[index];
    const value = sum(
      linked.map((row) => toEur(at?.get(row.id) ?? dec(0), row.currency, input.rates)),
    );
    const interest = sum(
      linked.map((row) =>
        toEur(
          interestTotal(
            accountInterest(
              {
                deposit: input.deposits.get(row.id) ?? null,
                manual: input.interestEntries.filter((entry) => entry.accountId === row.id),
                transactions: input.transactions.filter((t) => t.accountId === row.id),
              },
              end,
              input.defaultTax,
            ),
            end,
          ),
          row.currency,
          input.rates,
        ),
      ),
    );
    result.set(month, { value: toPlain(value), interest: toPlain(interest) });
  });
  return result;
}
