import {
  accountsRepo,
  categoriesRepo,
  categorySettingsRepo,
  investmentOpsRepo,
  netWorthSnapshotsRepo,
  poolSettingsRepo,
  portfolioCashMovesRepo,
  transactionsRepo,
  withPool,
  type PoolContext,
  type PoolRunner,
  type PoolTx,
  type SnapshotValues,
} from '@nestvault/db';
import {
  lastMonths,
  monthEnd,
  monthKey,
  monthsBetween,
  netWorths,
  toFxRates,
  toPlain,
  type Category,
  type CategoryKind,
  type LedgerData,
  type Transaction,
} from '@nestvault/domain';

import { toLedgerAccount } from '../accounts/ledger';
import { can } from '../guards/pool-access';
import { toCashMove, toInvestmentOp } from '../investments/domain';
import { loadAssets } from '../overview/summary-input';
import { installmentOf, loadRealEstateLedger } from '../real-estate';
import { loadSavingsLedger } from '../savings/domain';
import { loadFxRates } from '../settings/fx';

/** The oldest month a backfill goes back to: 50 years is far past any household's records. */
export const SNAPSHOT_MAX_MONTHS = 600;
const DEFAULT_TAX = '28';

function earliest(dates: readonly (string | null | undefined)[]): string | null {
  let first: string | null = null;
  for (const date of dates) if (date && (first === null || date < first)) first = date;
  return first;
}

/** Everything `netWorths` reads, loaded once for the pool; also the date of the first record. */
async function loadLedger(
  tx: PoolTx,
  ctx: PoolContext,
  today: string,
  priceFrom: (firstDate: string | null) => string,
): Promise<{ data: LedgerData; firstDate: string | null }> {
  const [
    accountRows,
    opRows,
    moveRows,
    txRows,
    categoryRows,
    settingRows,
    pool,
    savings,
    resolved,
  ] = await Promise.all([
    accountsRepo.list(tx, ctx),
    investmentOpsRepo.list(tx, ctx),
    portfolioCashMovesRepo.list(tx, ctx),
    transactionsRepo.listForOverview(tx, ctx),
    categoriesRepo.list(tx, ctx),
    categorySettingsRepo.list(tx, ctx),
    poolSettingsRepo.find(tx, ctx),
    loadSavingsLedger(tx, ctx),
    loadFxRates(tx, ctx, today),
  ]);
  const realEstate = await loadRealEstateLedger(tx, ctx);
  const ops = opRows.map(toInvestmentOp);
  const transactions: Transaction[] = txRows.map((row) => ({
    id: '',
    ...row,
    ...installmentOf(realEstate.splits, row.loanInstallmentId),
  }));
  const firstDate = earliest([
    ...txRows.map((row) => row.date),
    ...ops.map((op) => op.date),
    ...accountRows.map((row) => row.openingDate),
  ]);
  const assets = await loadAssets(tx, ctx, priceFrom(firstDate), today);
  const categories: Category[] = categoryRows.map((row) => ({
    id: row.id,
    kind: row.kind as CategoryKind,
    systemKey: row.systemKey,
  }));
  const budgets: Record<string, string> = {};
  for (const row of settingRows) if (row.monthlyBudget) budgets[row.categoryId] = row.monthlyBudget;
  const data: LedgerData = {
    accounts: accountRows.map((row) => toLedgerAccount(row, savings.deposits.get(row.id))),
    transactions,
    interestEntries: savings.interestEntries,
    ops,
    assets,
    moves: moveRows.map(toCashMove),
    categories,
    budgets,
    rates: toFxRates(resolved),
    defaultTax: pool?.depositTax ?? DEFAULT_TAX,
    ...(realEstate.realEstate && { realEstate: realEstate.realEstate }),
  };
  return { data, firstDate };
}

/** The month ends from the month of `firstDate` up to the month before `today`'s, oldest first. */
export function pastMonthEnds(firstDate: string | null, today: string): string[] {
  if (!firstDate) return [];
  const count = Math.min(SNAPSHOT_MAX_MONTHS, monthsBetween(firstDate, today));
  if (count <= 0) return [];
  return lastMonths(count + 1, today)
    .slice(0, count)
    .map((month) => monthEnd(month));
}

export interface SnapshotOptions {
  /** The day being stored (`yyyy-mm-dd`); prices up to it are used. */
  today: string;
  /** Also rebuild every past month end from the records (the backfill). */
  backfill?: boolean;
}

/**
 * Computes the pool's net worth with the domain engine (`netWorths`) and stores one row per date:
 * `today` and, for a backfill, each past month end. Idempotent: a row is replaced, never doubled.
 * The context must hold `pool.read` and `snapshots.write`; nothing here can reach another pool.
 * Returns the number of rows stored.
 */
export async function snapshotPool(
  ctx: PoolContext,
  options: SnapshotOptions,
  run: PoolRunner = withPool,
): Promise<number> {
  can(ctx, 'pool.read');
  can(ctx, 'snapshots.write');
  const { today } = options;
  return run(ctx, async (tx) => {
    const { data, firstDate } = await loadLedger(tx, ctx, today, (first) =>
      options.backfill && first ? `${monthKey(first)}-01` : today,
    );
    const dates = [...(options.backfill ? pastMonthEnds(firstDate, today) : []), today];
    const worth = netWorths(data, dates, today);
    const rows: SnapshotValues[] = worth.map((w, i) => ({
      date: dates[i] ?? today,
      net: toPlain(w.net),
      cash: toPlain(w.cash),
      savings: toPlain(w.savings),
      investments: toPlain(w.investments),
      byCcy: Object.fromEntries(
        Object.entries(w.byCurrency).map(([currency, amount]) => [currency, toPlain(amount)]),
      ),
    }));
    await netWorthSnapshotsRepo.upsertMany(tx, ctx, rows);
    return rows.length;
  });
}
