import {
  accountsRepo,
  categoriesRepo,
  investmentOpsRepo,
  plansRepo,
  poolSettingsRepo,
  portfolioCashMovesRepo,
  portfoliosRepo,
  subAccountsRepo,
  transactionsRepo,
  type AccountRow,
  type GoalRow,
  type GoalScopeRow,
  type PlanRow,
  type PoolContext,
  type PoolTx,
  type SubAccountRow,
} from '@nestvault/db';
import {
  accountBalancesAt,
  depositValue,
  toFxRates,
  type Category,
  type CategoryKind,
  type Deposit,
  type FxRates,
  type Goal,
  type GoalAccount,
  type GoalData,
  type GoalMode,
  type GoalType,
  type InvestmentAsset,
  type InvestmentOp,
  type PortfolioCashMove,
  type SummaryAccount,
  type Transaction,
} from '@nestvault/domain';

import { accountKindOf, toLedgerAccount } from '../accounts/ledger';
import { toCashMove, toInvestmentOp } from '../investments/domain';
import { loadAssets, summaryAccountsOf } from '../overview/summary-input';
import { loadSavingsLedger } from '../savings/domain';
import { loadFxRates } from '../settings/fx';

const DEFAULT_TAX = '28';

/** A goal row and its scopes as the domain's `goalCalc` reads them. */
export function toDomainGoal(row: GoalRow, scopes: readonly GoalScopeRow[]): Goal {
  const type = row.type as GoalType;
  const portfolioIds = scopes.flatMap((scope) => (scope.portfolioId ? [scope.portfolioId] : []));
  // An account is `accountId`, a sub-account `accountId|subAccountId` (the domain's keys).
  const accounts = scopes.flatMap((scope) =>
    scope.accountId
      ? [scope.subAccountId ? `${scope.accountId}|${scope.subAccountId}` : scope.accountId]
      : [],
  );
  return {
    type,
    target: row.target,
    rate: row.rate,
    monthly: row.monthly,
    yield: row.yield,
    deadline: row.deadline,
    when: row.mode as GoalMode,
    portfolioIds,
    accounts,
    includeSavings: row.includeSavings,
  };
}

export interface GoalDataParts {
  accountRows: readonly AccountRow[];
  subAccountRows: readonly SubAccountRow[];
  /** The accounts as the summary reads them, with today's balance and interest. */
  summaryAccounts: readonly SummaryAccount[];
  deposits: ReadonlyMap<string, Deposit>;
  defaultTax: string;
  today: string;
  ops: readonly InvestmentOp[];
  assets: readonly InvestmentAsset[];
  moves: readonly PortfolioCashMove[];
  rates: FxRates;
  portfolios: readonly { id: string; name: string }[];
  planRows: readonly PlanRow[];
}

/** Everything `goalCalc` needs, from what the caller has already loaded. */
export function toGoalData(parts: GoalDataParts): GoalData {
  const summaryOf = new Map(parts.summaryAccounts.map((account) => [account.id, account]));
  const subsOf = new Map<string, { id: string; name: string }[]>();
  for (const sub of parts.subAccountRows) {
    const list = subsOf.get(sub.accountId) ?? [];
    list.push({ id: sub.id, name: sub.name });
    subsOf.set(sub.accountId, list);
  }
  const accounts: GoalAccount[] = [];
  for (const row of parts.accountRows) {
    const summary = summaryOf.get(row.id);
    if (!summary) continue;
    const deposit = parts.deposits.get(row.id);
    accounts.push({
      ...summary,
      name: row.name,
      kind: accountKindOf(row.type),
      capital: deposit?.capital ?? null,
      returned: deposit ? depositValue(deposit, parts.today, parts.defaultTax).returned : false,
      subAccounts: subsOf.get(row.id) ?? [],
    });
  }
  return {
    ops: parts.ops,
    assets: parts.assets,
    accounts,
    moves: parts.moves,
    rates: parts.rates,
    portfolios: parts.portfolios,
    plans: parts.planRows.map((plan) => ({
      active: plan.active,
      amount: plan.amount,
      portfolioId: plan.portfolioId,
      accountId: plan.accountId,
      subAccountId: plan.subAccountId,
    })),
  };
}

/** Loads the pool's data for the goals screen (the overview builds the same from its own load). */
export async function loadGoalData(tx: PoolTx, ctx: PoolContext, today: string): Promise<GoalData> {
  const [accountRows, subAccountRows, opRows, moveRows, txRows, categoryRows, portfolioRows, pool] =
    await Promise.all([
      accountsRepo.list(tx, ctx),
      subAccountsRepo.list(tx, ctx),
      investmentOpsRepo.list(tx, ctx),
      portfolioCashMovesRepo.list(tx, ctx),
      transactionsRepo.listForOverview(tx, ctx),
      categoriesRepo.list(tx, ctx),
      portfoliosRepo.list(tx, ctx),
      poolSettingsRepo.find(tx, ctx),
    ]);
  const [planRows, savings, resolved, assets] = await Promise.all([
    plansRepo.list(tx, ctx),
    loadSavingsLedger(tx, ctx),
    loadFxRates(tx, ctx, today),
    loadAssets(tx, ctx, today, today),
  ]);
  const rates = toFxRates(resolved);
  const ops = opRows.map(toInvestmentOp);
  const moves = moveRows.map(toCashMove);
  const transactions: Transaction[] = txRows.map((row) => ({ id: '', ...row }));
  const defaultTax = pool?.depositTax ?? DEFAULT_TAX;
  const categories: Category[] = categoryRows.map((row) => ({
    id: row.id,
    kind: row.kind as CategoryKind,
    systemKey: row.systemKey,
  }));

  const [balances] = accountBalancesAt(
    {
      accounts: accountRows.map((row) => toLedgerAccount(row, savings.deposits.get(row.id))),
      transactions,
      interestEntries: savings.interestEntries,
      ops,
      assets,
      moves,
      categories,
      budgets: {},
      rates,
      defaultTax,
    },
    [today],
  );
  const { accounts: summaryAccounts } = summaryAccountsOf({
    accountRows,
    balances: balances ?? new Map(),
    transactions,
    deposits: savings.deposits,
    interestEntries: savings.interestEntries,
    categoryById: new Map(categoryRows.map((row) => [row.id, row])),
    rates,
    defaultTax,
    today,
  });
  return toGoalData({
    accountRows,
    subAccountRows,
    summaryAccounts,
    deposits: savings.deposits,
    defaultTax,
    today,
    ops,
    assets,
    moves,
    rates,
    portfolios: portfolioRows,
    planRows,
  });
}
