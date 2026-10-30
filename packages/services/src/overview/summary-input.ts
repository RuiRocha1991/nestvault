import {
  assetPricesRepo,
  assetsRepo,
  type AccountRow,
  type PoolContext,
  type PoolTx,
} from '@nestvault/db';
import {
  accountInterest,
  dec,
  interestLast12Months,
  interestTotal,
  toEur,
  toPlain,
  type Dec,
  type Deposit,
  type FxRates,
  type InterestCandidate,
  type InvestmentAsset,
  type ManualInterestEntry,
  type SummaryAccount,
  type Transaction,
} from '@nestvault/domain';

/** The price history from `from` on, with the price in force at `from` as its first entry. */
export async function loadAssets(
  tx: PoolTx,
  ctx: PoolContext,
  from: string,
  today: string,
): Promise<InvestmentAsset[]> {
  const [assetRows, baseline, later] = await Promise.all([
    assetsRepo.list(tx, ctx),
    assetPricesRepo.latestAsOf(tx, ctx, from),
    assetPricesRepo.since(tx, ctx, from),
  ]);
  const history = new Map<string, { date: string; price: string }[]>();
  for (const row of [...baseline, ...later]) {
    const list = history.get(row.assetId) ?? [];
    list.push({ date: row.date, price: row.price });
    history.set(row.assetId, list);
  }
  return assetRows.map((row) => {
    const prices = history.get(row.id) ?? [];
    // The price in force today: the newest entry dated up to today (a future one is ignored).
    let current: { date: string; price: string } | undefined;
    for (const entry of prices) {
      if (entry.date <= today && (!current || entry.date >= current.date)) current = entry;
    }
    return {
      id: row.id,
      currency: row.currency,
      price: current?.price ?? '0',
      prices,
      dps: row.dps,
      divMonths: row.divMonths,
    };
  });
}

export interface SummaryAccountsInput {
  accountRows: readonly AccountRow[];
  /** Balances of today by account id. */
  balances: ReadonlyMap<string, Dec>;
  /** The movements the interest is read from (the overview reads few columns). */
  transactions: readonly Transaction[];
  deposits: ReadonlyMap<string, Deposit>;
  interestEntries: readonly ManualInterestEntry[];
  /** Category of every row id, by category id (to tell interest from other income). */
  categoryById: ReadonlyMap<
    string,
    { kind: string; name: string | null; systemKey: string | null }
  >;
  rates: FxRates;
  defaultTax: string;
  today: string;
}

/**
 * The accounts as the portfolio summary reads them, with their balance and interest of today, and
 * the EUR interest of the last 12 months (the overview's passive income figure).
 */
export function summaryAccountsOf(input: SummaryAccountsInput): {
  accounts: SummaryAccount[];
  interest12: Dec;
} {
  const { accountRows, balances, deposits, interestEntries, rates, defaultTax, today } = input;
  const candidatesOf = new Map<string, InterestCandidate[]>();
  for (const movement of input.transactions) {
    // Interest is money coming in: expenses (the bulk of the rows) can be skipped at once.
    if (String(movement.amount).startsWith('-')) continue;
    const category = movement.categoryId ? input.categoryById.get(movement.categoryId) : undefined;
    const list = candidatesOf.get(movement.accountId) ?? [];
    list.push({
      id: movement.id,
      date: movement.date,
      amount: movement.amount,
      description: movement.description,
      ...(movement.transfer !== undefined && { transfer: movement.transfer }),
      ...(movement.depositInterest !== undefined && {
        depositInterest: movement.depositInterest,
      }),
      category: category
        ? { kind: category.kind, name: category.name, systemKey: category.systemKey }
        : null,
    });
    candidatesOf.set(movement.accountId, list);
  }
  let interest12 = dec(0);
  const accounts = accountRows.map((row): SummaryAccount => {
    const entries = accountInterest(
      {
        deposit: deposits.get(row.id) ?? null,
        manual: interestEntries.filter((entry) => entry.accountId === row.id),
        transactions: candidatesOf.get(row.id) ?? [],
      },
      today,
      defaultTax,
    );
    interest12 = interest12.plus(toEur(interestLast12Months(entries, today), row.currency, rates));
    return {
      id: row.id,
      currency: row.currency,
      trackCash: row.trackCash,
      isBrokerage: row.type === 'brokerage',
      portfolioId: row.portfolioId,
      balance: balances.get(row.id) ?? '0',
      interest: toPlain(interestTotal(entries, today)),
    };
  });
  return { accounts, interest12 };
}
