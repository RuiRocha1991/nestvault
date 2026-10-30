import {
  accountsRepo,
  categoriesRepo,
  categorySettingsRepo,
  goalsRepo,
  investmentOpsRepo,
  plansRepo,
  poolSettingsRepo,
  portfolioCashMovesRepo,
  portfoliosRepo,
  subAccountsRepo,
  transactionsRepo,
  withPool,
  type IdentityDatabase,
  type PoolContext,
  type PoolRunner,
  type PoolTx,
} from '@nestvault/db';
import {
  accountBalancesAt,
  dec,
  dividendsForecast,
  dividendsReceived,
  hasDividends,
  expensesByCategory,
  fx,
  goalCalc,
  lastMonths,
  monthEnd,
  monthFlows,
  monthKey,
  monthsBetween,
  netWorths,
  nextMonths,
  portfolioSummary,
  sum,
  toFxRates,
  toPlain,
  type Category,
  type CategoryKind,
  type Dec,
  type FxRates,
  type LedgerData,
  type PortfolioSummary,
  type Transaction,
} from '@nestvault/domain';

import { toLedgerAccount } from '../accounts/ledger';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { ValidationError } from '../errors';
import { toDomainGoal, toGoalData } from '../goals/goal-data';
import { can, requirePoolAccess } from '../guards/pool-access';
import { toCashMove, toInvestmentOp } from '../investments/domain';
import { installmentOf, loadRealEstateLedger } from '../real-estate';
import { loadSavingsLedger } from '../savings/domain';
import { loadFxRates } from '../settings/fx';

import { OVERVIEW_MAX_MONTHS, OverviewDto, OverviewQuery, type OverviewRange } from './schemas';
import { loadAssets, summaryAccountsOf } from './summary-input';

export interface OverviewService {
  /**
   * Everything the overview screen shows, in one read: KPIs with sparklines, net worth evolution,
   * portfolios, this month's expenses by category and the dividend forecast (any member).
   */
  get(headers: Headers, poolId: string, query?: unknown): Promise<OverviewDto>;
}

export interface OverviewServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  now?: () => Date;
}

const ZERO = dec(0);
const HUNDRED = dec(100);
const FORECAST_MONTHS = 12;
const FALLBACK_COLOR = '#8C8FB8';
const DEFAULT_TAX = '28';

/** `part / whole` as a percentage; 0 without a whole. */
const percent = (part: Dec, whole: Dec): Dec =>
  whole.isZero() ? ZERO : part.div(whole).times(HUNDRED);

/** Change of `current` against `previous` in percent; 0 when there is nothing to compare with. */
const change = (current: Dec, previous: Dec): Dec =>
  previous.isZero() ? ZERO : current.minus(previous).div(previous).times(HUNDRED);

const plain = (values: readonly Dec[]): string[] => values.map((value) => toPlain(value));

function earliest(dates: readonly (string | null | undefined)[]): string | null {
  let first: string | null = null;
  for (const date of dates) if (date && (first === null || date < first)) first = date;
  return first;
}

export function createOverviewService(deps: OverviewServiceDeps): OverviewService {
  const { auth, identity } = deps;
  const run = deps.run ?? withPool;
  const now = deps.now ?? (() => new Date());

  /** The months of the chart: the last 6, 12 or 24, or from the first record up to the cap. */
  function monthsOf(range: OverviewRange, today: string, firstDate: string | null): string[] {
    if (range !== 'all') return lastMonths(Number(range), today);
    const first = firstDate ? Math.max(1, monthsBetween(firstDate, today) + 1) : 1;
    // At least 2 months so the "previous month" has something to compare with.
    return lastMonths(Math.min(OVERVIEW_MAX_MONTHS, Math.max(2, first)), today);
  }

  async function load(
    tx: PoolTx,
    ctx: PoolContext,
    today: string,
    range: OverviewRange,
  ): Promise<OverviewDto> {
    const [
      accountRows,
      opRows,
      moveRows,
      txRows,
      categoryRows,
      settingRows,
      portfolioRows,
      pool,
      savings,
      resolved,
      goalRows,
      goalScopeRows,
      planRows,
      subAccountRows,
    ] = await Promise.all([
      accountsRepo.list(tx, ctx),
      investmentOpsRepo.list(tx, ctx),
      portfolioCashMovesRepo.list(tx, ctx),
      transactionsRepo.listForOverview(tx, ctx),
      categoriesRepo.list(tx, ctx),
      categorySettingsRepo.list(tx, ctx),
      portfoliosRepo.list(tx, ctx),
      poolSettingsRepo.find(tx, ctx),
      loadSavingsLedger(tx, ctx),
      loadFxRates(tx, ctx, today),
      goalsRepo.list(tx, ctx),
      goalsRepo.listScopes(tx, ctx),
      plansRepo.list(tx, ctx),
      subAccountsRepo.list(tx, ctx),
    ]);
    const realEstate = await loadRealEstateLedger(tx, ctx);
    const rates: FxRates = toFxRates(resolved);
    const ops = opRows.map(toInvestmentOp);
    const moves = moveRows.map(toCashMove);
    // The overview reads few columns and no ids; the rows are in no particular order.
    const transactions: Transaction[] = txRows.map((row) => ({
      id: '',
      ...row,
      ...installmentOf(realEstate.splits, row.loanInstallmentId),
    }));
    let firstTransaction: string | null = null;
    for (const row of txRows)
      if (firstTransaction === null || row.date < firstTransaction) firstTransaction = row.date;
    const defaultTax = pool?.depositTax ?? DEFAULT_TAX;

    // "All" starts at the first record, whichever kind of record it is.
    const firstDate = earliest([
      firstTransaction,
      ...ops.map((op) => op.date),
      ...accountRows.map((row) => row.openingDate),
    ]);
    const months = monthsOf(range, today, firstDate);
    const current = monthKey(today);
    const dates = months.map((month) => (month === current ? today : monthEnd(month)));
    const assets = await loadAssets(tx, ctx, `${months[0] ?? current}-01`, today);

    const kindOfCategory = (kind: string) => kind as CategoryKind;
    const categories: Category[] = categoryRows.map((row) => ({
      id: row.id,
      kind: kindOfCategory(row.kind),
      systemKey: row.systemKey,
    }));
    const budgets: Record<string, string> = {};
    for (const row of settingRows)
      if (row.monthlyBudget) budgets[row.categoryId] = row.monthlyBudget;

    const data: LedgerData = {
      accounts: accountRows.map((row) => toLedgerAccount(row, savings.deposits.get(row.id))),
      transactions,
      interestEntries: savings.interestEntries,
      ops,
      assets,
      moves,
      categories,
      budgets,
      rates,
      defaultTax,
      ...(realEstate.realEstate && { realEstate: realEstate.realEstate }),
    };

    // Balances and interest of today feed the summaries; interest also gives the 12-month figure.
    // One pass over the movements gives every month end and today (the last date).
    const balancesAt = accountBalancesAt(data, dates);
    const balances = balancesAt[balancesAt.length - 1] ?? new Map<string, Dec>();
    const categoryById = new Map(categoryRows.map((row) => [row.id, row]));
    const { accounts: summaryAccounts, interest12 } = summaryAccountsOf({
      accountRows,
      balances,
      transactions,
      deposits: savings.deposits,
      interestEntries: savings.interestEntries,
      categoryById,
      rates,
      defaultTax,
      today,
    });

    const summaryInput = { ops, assets, accounts: summaryAccounts, moves, rates };
    const summaryOf = (portfolioIds?: string[]): PortfolioSummary =>
      portfolioSummary(summaryInput, {
        asOf: today,
        today,
        ...(portfolioIds ? { portfolioIds } : {}),
      });
    const all = summaryOf();

    // The goals card: the same calculation as the goals screen, from the data loaded above.
    const goalData = goalRows.length
      ? toGoalData({
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
        })
      : null;
    const goalViews = goalData
      ? goalRows.map((row) => {
          const own = goalScopeRows.filter((scope) => scope.goalId === row.id);
          const result = goalCalc(toDomainGoal(row, own), goalData, today);
          return {
            id: row.id,
            name: row.name,
            color: row.color,
            progress: toPlain(result.progress),
            status: result.status,
            etaMonth: result.etaMonth,
          };
        })
      : [];

    const worth = netWorths(data, dates, today, balancesAt);
    const totals = worth.map((w) => w.net);
    const investments = worth.map((w) => w.investments);
    const flows = monthFlows(data, months);
    const flow = flows[flows.length - 1];
    const previousFlow = flows[flows.length - 2];
    const netNow = totals[totals.length - 1] ?? ZERO;
    const netBefore = totals[totals.length - 2] ?? totals[0] ?? ZERO;

    const budgetTotal = sum(
      categories
        .filter((category) => category.kind === 'expense')
        .map((category) => budgets[category.id] ?? 0),
    );
    const expensesNow = flow?.expenses ?? ZERO;

    const byCategory = expensesByCategory(data, current);
    const settingOf = new Map(settingRows.map((row) => [row.categoryId, row]));
    const expenseItems = byCategory.map((item) => {
      const row = item.categoryId ? categoryById.get(item.categoryId) : undefined;
      const setting = item.categoryId ? settingOf.get(item.categoryId) : undefined;
      return {
        categoryId: item.categoryId,
        systemKey: row?.systemKey ?? null,
        name: row?.name ?? null,
        color: setting?.colorOverride ?? row?.color ?? FALLBACK_COLOR,
        value: toPlain(item.value),
      };
    });

    const forecastMonths = nextMonths(FORECAST_MONTHS, today);
    const forecast = dividendsForecast(all.holdings, forecastMonths);
    const received = dividendsReceived(ops, assets, rates, months);

    return OverviewDto.parse({
      asOf: today,
      range,
      empty: accountRows.length === 0 && ops.length === 0,
      kpis: {
        netWorth: {
          value: toPlain(netNow),
          changePct: toPlain(change(netNow, netBefore)),
          spark: plain(totals),
        },
        investments: {
          value: toPlain(all.value),
          returnPct: toPlain(all.totalPct.times(HUNDRED)),
          spark: plain(investments),
        },
        passiveIncome: {
          annual: toPlain(all.income),
          monthly: toPlain(all.income.div(12)),
          yieldPct: toPlain(all.yld.times(HUNDRED)),
          interest12: toPlain(interest12),
          spark: plain(received),
        },
        monthExpenses: {
          value: toPlain(expensesNow),
          budget: budgetTotal.gt(0) ? toPlain(budgetTotal) : null,
          budgetUsedPct: budgetTotal.gt(0) ? toPlain(percent(expensesNow, budgetTotal)) : null,
          changePct: toPlain(change(expensesNow, previousFlow?.expenses ?? ZERO)),
          spark: plain(flows.map((f) => f.expenses)),
        },
      },
      realEstate: realEstate.realEstate
        ? {
            value: toPlain(worth[worth.length - 1]?.realEstate ?? ZERO),
            liabilities: toPlain(worth[worth.length - 1]?.liabilities ?? ZERO),
          }
        : null,
      evolution: { months, total: plain(totals), investments: plain(investments) },
      goals: goalViews,
      portfolios: portfolioRows.map((row) => {
        const summary = summaryOf([row.id]);
        return {
          id: row.id,
          name: row.name,
          color: row.color,
          currency: row.currency,
          value: toPlain(summary.valueAll.div(fx(row.currency, rates))),
          returnPct: toPlain(summary.profitPct.times(HUNDRED)),
        };
      }),
      expenses: { month: current, total: toPlain(expensesNow), categories: expenseItems },
      dividends: {
        months: forecastMonths,
        values: plain(forecast.map((month) => month.value)),
        total: toPlain(sum(forecast.map((month) => month.value))),
        hasDividends: hasDividends(ops, assets, all.holdings),
      },
    });
  }

  return {
    async get(headers, poolId, query = {}) {
      const session = await requireSession(auth, headers);
      const parsed = OverviewQuery.safeParse(query);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const today = now().toISOString().slice(0, 10);
      return run(ctx, (tx) => load(tx, ctx, today, parsed.data.range));
    },
  };
}
