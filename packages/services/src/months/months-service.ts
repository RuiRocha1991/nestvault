import {
  accountsRepo,
  assetPricesRepo,
  assetsRepo,
  categoriesRepo,
  categorySettingsRepo,
  investmentOpsRepo,
  monthNotesRepo,
  notesRepo,
  poolSettingsRepo,
  portfolioCashMovesRepo,
  portfoliosRepo,
  transactionsRepo,
  withPool,
  type IdentityDatabase,
  type PoolRunner,
} from '@nestvault/db';
import {
  addMonths,
  dec,
  lastMonths,
  monthEnd,
  monthFlows,
  monthReview,
  netWorths,
  roundTo,
  toFxRates,
  toPlain,
  type Category,
  type CategoryKind,
  type Dec,
  type LedgerData,
} from '@nestvault/domain';

import { toLedgerAccount } from '../accounts/ledger';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { ValidationError } from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';
import { toInvestmentOp, toCashMove } from '../investments/domain';
import { MonthParam, emptyMonthNote, toMonthNoteDto } from '../notes/schemas';
import { installmentOf, loadRealEstateLedger } from '../real-estate';
import { loadSavingsLedger } from '../savings/domain';
import { loadFxRates } from '../settings/fx';
import { toEngineTransaction } from '../transactions/engine';

import { MonthReviewDto } from './schemas';

export interface MonthsService {
  /**
   * The monthly review of `month` (`yyyy-mm`): KPIs, expenses by category, notable transactions,
   * the month's investment operations, the month note and a 12-month timeline (any member).
   */
  review(headers: Headers, poolId: string, month: string): Promise<MonthReviewDto>;
}

export interface MonthsServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  trustedProxyHops?: number;
  now?: () => Date;
}

const TIMELINE_MONTHS = 12;
const plain = (value: Dec) => toPlain(roundTo(value, 4));
const percent = (value: Dec) => toPlain(roundTo(value.times(100), 2));

export function createMonthsService(deps: MonthsServiceDeps): MonthsService {
  const { auth, identity } = deps;
  const run = deps.run ?? withPool;
  const now = deps.now ?? (() => new Date());

  return {
    async review(headers, poolId, month) {
      const session = await requireSession(auth, headers);
      // An invalid month answers 400 like the month note.
      if (!MonthParam.safeParse(month).success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const today = now().toISOString().slice(0, 10);
      const first = `${month}-01`;
      const end = monthEnd(month);
      const timelineMonths = lastMonths(TIMELINE_MONTHS, first);
      const timelineFrom = `${timelineMonths[0] ?? month}-01`;

      const review = await run(ctx, async (tx) => {
        const [
          accountRows,
          categoryRows,
          settingRows,
          txRows,
          opRows,
          assetRows,
          portfolioRows,
          moveRows,
          resolved,
          settings,
          savings,
          txNotes,
          note,
          timelineNotes,
          realEstate,
        ] = await Promise.all([
          accountsRepo.list(tx, ctx),
          categoriesRepo.list(tx, ctx),
          categorySettingsRepo.list(tx, ctx),
          transactionsRepo.listForEngine(tx, ctx),
          investmentOpsRepo.list(tx, ctx),
          assetsRepo.list(tx, ctx),
          portfoliosRepo.list(tx, ctx),
          portfolioCashMovesRepo.list(tx, ctx),
          loadFxRates(tx, ctx, today),
          poolSettingsRepo.find(tx, ctx),
          loadSavingsLedger(tx, ctx),
          notesRepo.listTransactionNotes(tx, ctx, first, end),
          monthNotesRepo.find(tx, ctx, first),
          monthNotesRepo.list(tx, ctx, timelineFrom, first),
          loadRealEstateLedger(tx, ctx),
        ]);
        const prices = await assetPricesRepo.latestAsOf(tx, ctx, today);
        const latest = new Map(prices.map((price) => [price.assetId, price.price]));

        const noteById = new Map(txNotes.map((row) => [row.id, row]));
        const categories = categoryRows.map((row): Category => ({
          id: row.id,
          kind: row.kind as CategoryKind,
          systemKey: row.systemKey,
        }));
        const budgets: Record<string, string> = {};
        for (const row of settingRows) {
          if (row.monthlyBudget !== null && dec(row.monthlyBudget).gt(0)) {
            budgets[row.categoryId] = row.monthlyBudget;
          }
        }
        const data: LedgerData = {
          accounts: accountRows.map((row) => toLedgerAccount(row, savings.deposits.get(row.id))),
          transactions: txRows.map((row) => ({
            ...toEngineTransaction(row),
            note: noteById.get(row.id)?.note ?? null,
            ...installmentOf(realEstate.splits, row.loanInstallmentId),
          })),
          interestEntries: savings.interestEntries,
          ops: opRows.map((row) => ({ ...toInvestmentOp(row), note: row.note })),
          assets: assetRows.map((row) => ({
            id: row.id,
            currency: row.currency,
            price: latest.get(row.id) ?? '0',
            dps: row.dps,
            divMonths: row.divMonths,
          })),
          moves: moveRows.map(toCashMove),
          categories,
          budgets,
          rates: toFxRates(resolved),
          defaultTax: settings?.depositTax ?? '28',
          ...(realEstate.realEstate && { realEstate: realEstate.realEstate }),
        };

        const result = monthReview(data, month, today);
        const flows = monthFlows(data, timelineMonths);
        const worths = netWorths(data, timelineMonths.map(monthEnd), today);
        const withNote = new Set(timelineNotes.map((row) => row.month.slice(0, 7)));

        const accountName = new Map(accountRows.map((row) => [row.id, row.name]));
        const portfolioName = new Map(portfolioRows.map((row) => [row.id, row.name]));
        const ticker = new Map(assetRows.map((row) => [row.id, row.ticker]));
        const opRow = new Map(opRows.map((row) => [row.id, row]));
        const hasBody = (text: string | null | undefined): text is string =>
          typeof text === 'string' && text.trim() !== '';

        return {
          month,
          previousMonth: addMonths(first, -1).slice(0, 7),
          nextMonth: month < today.slice(0, 7) ? addMonths(first, 1).slice(0, 7) : null,
          income: plain(result.income),
          expenses: plain(result.expenses),
          savings: plain(result.savings),
          savingsRatePct: result.savingsRate ? percent(result.savingsRate) : null,
          netWorthEnd: plain(result.netWorthEnd),
          netWorthPrevious: plain(result.netWorthPrevious),
          netWorthChange: plain(result.netWorthChange),
          invested: plain(result.invested),
          loanCapital: plain(result.loanCapital),
          dividendsReceived: plain(result.dividendsReceived),
          interestReceived: plain(result.interestReceived),
          categories: result.categories.map((c) => ({
            categoryId: c.categoryId,
            value: plain(c.value),
            budget: c.budget ? plain(c.budget) : null,
            budgetUsedPct: c.budgetUsed ? percent(c.budgetUsed) : null,
            previousAverage: plain(c.previousAverage),
            difference: plain(c.difference),
          })),
          notable: result.notable.map((n) => {
            const state = noteById.get(n.transaction.id);
            return {
              id: n.transaction.id,
              accountId: n.transaction.accountId,
              accountName: accountName.get(n.transaction.accountId) ?? '',
              date: n.transaction.date,
              description: n.transaction.description,
              amount: plain(n.amount),
              kind: n.kind,
              reasons: n.reasons,
              note: hasBody(state?.note) ? state.note : null,
              noteUpdatedBy: state?.noteUpdatedBy ?? null,
              noteUpdatedAt: state?.noteUpdatedAt?.toISOString() ?? null,
            };
          }),
          operations: result.operations.map((group) => ({
            portfolioId: group.portfolioId,
            portfolioName: group.portfolioId
              ? (portfolioName.get(group.portfolioId) ?? null)
              : null,
            operations: group.operations.map(({ op, cashEffect }) => {
              const row = opRow.get(op.id);
              return {
                id: op.id,
                date: op.date,
                type: op.type,
                assetId: op.assetId,
                ticker: ticker.get(op.assetId) ?? '',
                qty: op.qty === null || op.qty === undefined ? null : toPlain(op.qty),
                cashEffect: plain(cashEffect),
                note: hasBody(row?.note) ? row.note : null,
                noteUpdatedBy: row?.noteUpdatedBy ?? null,
                noteUpdatedAt: row?.noteUpdatedAt?.toISOString() ?? null,
              };
            }),
          })),
          note: note ? toMonthNoteDto(note) : emptyMonthNote(month),
          timeline: timelineMonths.map((m, i) => ({
            month: m,
            income: plain(flows[i]?.income ?? dec(0)),
            expenses: plain(flows[i]?.expenses ?? dec(0)),
            savings: plain(flows[i]?.savings ?? dec(0)),
            netWorth: plain(worths[i]?.net ?? dec(0)),
            hasNote: withNote.has(m),
          })),
        };
      });
      return MonthReviewDto.parse(review);
    },
  };
}
