import {
  accountsRepo,
  assetsRepo,
  categoriesRepo,
  categorySettingsRepo,
  investmentOpsRepo,
  poolSettingsRepo,
  transactionsRepo,
  withPool,
  type IdentityDatabase,
  type PoolContext,
  type PoolRunner,
  type PoolTx,
  type TransactionFilter,
} from '@nestvault/db';
import {
  applyRules,
  expensesByCategory,
  lastMonths,
  monthFlows,
  sum,
  toEur,
  toFxRates,
  toPlain,
  type Category,
  type CategoryKind,
  type InvestmentAsset,
  type LedgerData,
} from '@nestvault/domain';

import { toLedgerAccount } from '../accounts/ledger';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { ValidationError } from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';
import { toInvestmentOp } from '../investments/domain';
import { loadSavingsLedger } from '../savings/domain';
import { loadFxRates } from '../settings/fx';
import { loadEngineContext, toEngineTransaction } from '../transactions/engine';
import { monthRange } from '../transactions/schemas';

import {
  ExpensesSummaryDto,
  ExpensesSummaryQuery,
  ExpensesUsageDto,
  MovementTotalsDto,
  MovementTotalsQuery,
} from './schemas';

export interface ExpensesService {
  /**
   * Income, expenses, savings rate, expenses by category with budget progress and the last twelve
   * months of one month (any member). The same domain functions feed the monthly review and the
   * overview, so the figures agree.
   */
  summary(headers: Headers, poolId: string, query?: unknown): Promise<ExpensesSummaryDto>;
  /** Totals of the movements a Movimentos filter selects, in EUR (any member). */
  totals(headers: Headers, poolId: string, query?: unknown): Promise<MovementTotalsDto>;
  /** Movements per category and, per rule, the movements it is the first match for (any member). */
  usage(headers: Headers, poolId: string): Promise<ExpensesUsageDto>;
}

export interface ExpensesServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  trustedProxyHops?: number;
  /** The clock; defaults to the system one. */
  now?: () => Date;
}

const HISTORY_MONTHS = 12;
const ZONE = 'Europe/Lisbon';
const lisbonMonth = (at: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit' })
    .format(at)
    .slice(0, 7);

export function createExpensesService(deps: ExpensesServiceDeps): ExpensesService {
  const { auth, identity } = deps;
  const run = deps.run ?? withPool;
  const now = deps.now ?? (() => new Date());

  /** What the month figures read: movements, interest, buys, categories and their budgets. */
  async function loadLedger(tx: PoolTx, ctx: PoolContext, asOf: string): Promise<LedgerData> {
    const [
      accountRows,
      txRows,
      categoryRows,
      settings,
      resolved,
      savings,
      opRows,
      assetRows,
      pool,
    ] = await Promise.all([
      accountsRepo.list(tx, ctx),
      transactionsRepo.listForEngine(tx, ctx),
      categoriesRepo.list(tx, ctx),
      categorySettingsRepo.list(tx, ctx),
      loadFxRates(tx, ctx, asOf),
      loadSavingsLedger(tx, ctx),
      investmentOpsRepo.list(tx, ctx),
      assetsRepo.list(tx, ctx),
      poolSettingsRepo.find(tx, ctx),
    ]);
    const categories = categoryRows.map((row): Category => ({
      id: row.id,
      kind: row.kind as CategoryKind,
      systemKey: row.systemKey,
    }));
    const budgets: Record<string, string> = {};
    for (const row of settings) {
      if (row.monthlyBudget !== null) budgets[row.categoryId] = row.monthlyBudget;
    }
    // Buys do not need a current price: only the asset's currency matters for their cash effect.
    const assets: InvestmentAsset[] = assetRows.map((row) => ({
      id: row.id,
      currency: row.currency,
      price: '0',
      dps: row.dps,
      divMonths: row.divMonths,
    }));
    return {
      accounts: accountRows.map((row) => toLedgerAccount(row, savings.deposits.get(row.id))),
      transactions: txRows.map(toEngineTransaction),
      interestEntries: savings.interestEntries,
      ops: opRows.map(toInvestmentOp),
      assets,
      moves: [],
      categories,
      budgets,
      rates: toFxRates(resolved),
      defaultTax: pool?.depositTax ?? '28',
    };
  }

  return {
    async summary(headers, poolId, query = {}) {
      const session = await requireSession(auth, headers);
      const parsed = ExpensesSummaryQuery.safeParse(query);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const at = now();
      const month = parsed.data.month ?? lisbonMonth(at);
      const months = lastMonths(HISTORY_MONTHS, `${month}-01`);
      const data = await run(ctx, (tx) => loadLedger(tx, ctx, at.toISOString().slice(0, 10)));
      const flows = monthFlows(data, months);
      const flow = flows.at(-1);
      if (!flow) throw new ValidationError();
      return ExpensesSummaryDto.parse({
        month,
        flow: {
          income: toPlain(flow.income),
          expenses: toPlain(flow.expenses),
          refunds: toPlain(flow.refunds),
          invested: toPlain(flow.invested),
          savings: toPlain(flow.savings),
          savingsRate: flow.savingsRate ? toPlain(flow.savingsRate) : null,
        },
        categories: expensesByCategory(data, month).map((entry) => ({
          categoryId: entry.categoryId,
          value: toPlain(entry.value),
          budget: entry.budget ? toPlain(entry.budget) : null,
          budgetUsed: entry.budgetUsed ? toPlain(entry.budgetUsed) : null,
          previousAverage: toPlain(entry.previousAverage),
          difference: toPlain(entry.difference),
        })),
        history: flows.map((entry) => ({
          month: entry.month,
          income: toPlain(entry.income),
          expenses: toPlain(entry.expenses),
        })),
      });
    },

    async totals(headers, poolId, query = {}) {
      const session = await requireSession(auth, headers);
      const parsed = MovementTotalsQuery.safeParse(query);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const q = parsed.data;
      const filter: TransactionFilter = {
        ...(q.month ? monthRange(q.month) : {}),
        ...(q.accountId ? { accountId: q.accountId.toLowerCase() } : {}),
        ...(q.categoryId
          ? { categoryId: q.categoryId === 'none' ? 'none' : q.categoryId.toLowerCase() }
          : {}),
        ...(q.kind ? { kind: q.kind } : {}),
        ...(q.q ? { text: q.q } : {}),
        ...(q.withNotes ? { withNotes: true } : {}),
      };
      const asOf = now().toISOString().slice(0, 10);
      const { rows, rates } = await run(ctx, async (tx) => ({
        rows: await transactionsRepo.totals(tx, ctx, filter),
        rates: toFxRates(await loadFxRates(tx, ctx, asOf)),
      }));
      const eurOf = (kind: string) =>
        sum(
          rows
            .filter((row) => row.kind === kind)
            .map((row) => toEur(row.total, row.currency, rates)),
        );
      const foreign = [...new Set(rows.map((row) => row.currency))].filter(
        (currency) => currency !== 'EUR',
      );
      return MovementTotalsDto.parse({
        income: toPlain(eurOf('income')),
        // Outflows are negative and refunds positive: the net expense is the opposite of the sum.
        expenses: toPlain(eurOf('expense').plus(eurOf('refund')).neg()),
        invested: toPlain(eurOf('invest').neg()),
        transfers: toPlain(eurOf('transfer')),
        uncategorized: rows.reduce((total, row) => total + row.uncategorized, 0),
        count: rows.reduce((total, row) => total + row.count, 0),
        rates: Object.fromEntries(
          foreign.map((currency) => [currency, toPlain(toEur(1, currency, rates))]),
        ),
      });
    },

    async usage(headers, poolId) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const { engine, rows } = await run(ctx, async (tx) => ({
        engine: await loadEngineContext(tx, ctx),
        rows: await transactionsRepo.listForEngine(tx, ctx),
      }));
      const categories: Record<string, number> = {};
      const rules: Record<string, number> = {};
      for (const row of rows) {
        if (row.categoryId) categories[row.categoryId] = (categories[row.categoryId] ?? 0) + 1;
        // `force`: the rule that would match even where the category was chosen by hand.
        const result = applyRules(toEngineTransaction(row), engine.rules, { force: true });
        if (result?.ruleId) rules[result.ruleId] = (rules[result.ruleId] ?? 0) + 1;
      }
      return ExpensesUsageDto.parse({ categories, rules });
    },
  };
}
