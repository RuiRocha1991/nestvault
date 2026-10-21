import {
  accountsRepo,
  assetPricesRepo,
  assetsRepo,
  investmentOpsRepo,
  newId,
  plansRepo,
  poolSettingsRepo,
  portfolioCashMovesRepo,
  portfoliosRepo,
  transactionsRepo,
  withPool,
  type IdentityDatabase,
  type PoolContext,
  type PoolRunner,
  type PoolTx,
} from '@nestvault/db';
import {
  accountBalances,
  accountInterest,
  interestTotal,
  portfolioSummary,
  toFxRates,
  toPlain,
  lastMonths,
  monthEnd,
  type InvestmentAsset,
  type SummaryAccount,
} from '@nestvault/domain';

import { toLedgerAccount } from '../accounts/ledger';
import { recordAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { isForeignKeyViolation, isUniqueViolation } from '../db-errors';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';
import { clientIpResolver } from '../rate-limit/client-ip';
import { loadSavingsLedger } from '../savings/domain';
import { loadFxRates } from '../settings/fx';
import { toEngineTransaction } from '../transactions/engine';

import { invalid, parseId } from './checks';
import { toCashMove, toInvestmentOp } from './domain';
import { buildPortfolioView, PortfolioViewDto, PERFORMANCE_MONTHS } from './portfolio-view';
import {
  CreatePortfolioInput,
  DeletePortfolioQuery,
  PortfolioDto,
  PortfolioListDto,
  PortfolioSummaryDto,
  SummaryQuery,
  toPortfolioDto,
  toSummaryDto,
  UpdatePortfolioInput,
} from './schemas';

export interface PortfoliosService {
  /** Every portfolio of the pool (any member). */
  list(headers: Headers, poolId: string): Promise<PortfolioListDto>;
  /** One portfolio (any member). */
  get(headers: Headers, poolId: string, id: string): Promise<PortfolioDto>;
  /** Creates a portfolio (`portfolios.write`); the name is unique inside the pool (409). */
  create(headers: Headers, poolId: string, input: unknown): Promise<PortfolioDto>;
  /** Changes a portfolio; fields left out stay (`portfolios.write`). */
  update(headers: Headers, poolId: string, id: string, input: unknown): Promise<PortfolioDto>;
  /**
   * Deletes a portfolio (`portfolios.write`). While it has operations, plans or cash moves,
   * `moveTo` (another portfolio, they all go there) or `deleteOps=true` (they are all deleted)
   * must say what happens to them; otherwise 409.
   */
  remove(headers: Headers, poolId: string, id: string, query?: unknown): Promise<void>;
  /** The domain's summary of one portfolio, or of all of them (any member). */
  summary(headers: Headers, poolId: string, query?: unknown): Promise<PortfolioSummaryDto>;
  /**
   * What the Portfolios screen shows beyond the summary: positions, operations, dividends,
   * monthly performance, allocation and diagnostics (any member). Read by the page, not exposed
   * as a REST route.
   */
  view(headers: Headers, poolId: string, query?: unknown): Promise<PortfolioViewDto>;
}

export interface PortfoliosServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  trustedProxyHops?: number;
  now?: () => Date;
}

export function createPortfoliosService(deps: PortfoliosServiceDeps): PortfoliosService {
  const { auth, identity } = deps;
  const run = deps.run ?? withPool;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);
  const now = deps.now ?? (() => new Date());
  const today = () => now().toISOString().slice(0, 10);

  const uniqueName = (error: unknown): never => {
    if (isUniqueViolation(error)) throw new ConflictError('A portfolio with this name exists.');
    throw error;
  };

  async function readOne(tx: PoolTx, ctx: PoolContext, id: string): Promise<PortfolioDto> {
    const row = await portfoliosRepo.find(tx, ctx, id);
    if (!row) throw new NotFoundError();
    return PortfolioDto.parse(toPortfolioDto(row, await countsOf(tx, ctx, id)));
  }

  async function countsOf(tx: PoolTx, ctx: PoolContext, id: string) {
    const [opsCount, plansCount] = await Promise.all([
      portfoliosRepo.countOps(tx, ctx, id),
      portfoliosRepo.countPlans(tx, ctx, id),
    ]);
    return { opsCount, plansCount };
  }

  /** The domain's inputs from the pool's rows: operations, priced assets and cash accounts. */
  async function loadSummary(
    tx: PoolTx,
    ctx: PoolContext,
    asOf: string,
    portfolioId: string | undefined,
  ) {
    const [opRows, assetRows, prices, accountRows, resolved, settings, savings, moveRows, txRows] =
      await Promise.all([
        investmentOpsRepo.list(tx, ctx),
        assetsRepo.list(tx, ctx),
        assetPricesRepo.latestAsOf(tx, ctx, asOf),
        accountsRepo.list(tx, ctx),
        loadFxRates(tx, ctx, asOf),
        poolSettingsRepo.find(tx, ctx),
        loadSavingsLedger(tx, ctx),
        portfolioCashMovesRepo.list(tx, ctx),
        transactionsRepo.listForEngine(tx, ctx),
      ]);
    const rates = toFxRates(resolved);
    const latest = new Map(prices.map((price) => [price.assetId, price.price]));
    const assets: InvestmentAsset[] = assetRows.map((row) => ({
      id: row.id,
      currency: row.currency,
      price: latest.get(row.id) ?? '0',
      dps: row.dps,
      divMonths: row.divMonths,
    }));
    const ops = opRows.map(toInvestmentOp);
    const moves = moveRows.map(toCashMove);
    // Balances follow the movements, operations, deposits, manual interest and the opening balance.
    const defaultTax = settings?.depositTax ?? '28';
    const balances = accountBalances(
      {
        accounts: accountRows.map((row) => toLedgerAccount(row, savings.deposits.get(row.id))),
        transactions: txRows.map(toEngineTransaction),
        interestEntries: savings.interestEntries,
        ops,
        assets,
        moves,
        categories: [],
        rates,
        defaultTax,
      },
      asOf,
    );
    const accounts: SummaryAccount[] = accountRows.map((row) => ({
      id: row.id,
      currency: row.currency,
      trackCash: row.trackCash,
      isBrokerage: row.type === 'brokerage',
      portfolioId: row.portfolioId,
      balance: balances.get(row.id) ?? '0',
      interest: toPlain(
        interestTotal(
          accountInterest(
            {
              deposit: savings.deposits.get(row.id) ?? null,
              manual: savings.interestEntries.filter((entry) => entry.accountId === row.id),
            },
            asOf,
            defaultTax,
          ),
          asOf,
        ),
      ),
    }));
    const summary = portfolioSummary(
      { ops, assets, accounts, moves, rates },
      { asOf, today: asOf, ...(portfolioId ? { portfolioIds: [portfolioId] } : {}) },
    );
    return { summary, rates };
  }

  return {
    async list(headers, poolId) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const rows = await run(ctx, (tx) => portfoliosRepo.listWithCounts(tx, ctx));
      return PortfolioListDto.parse({
        portfolios: rows.map(({ row, ...counts }) => toPortfolioDto(row, counts)),
      });
    },

    async get(headers, poolId, id) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const portfolioId = parseId(id);
      return run(ctx, (tx) => readOne(tx, ctx, portfolioId));
    },

    async create(headers, poolId, input) {
      const session = await requireSession(auth, headers);
      const parsed = CreatePortfolioInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'portfolios.write');
      const data = parsed.data;
      const id = newId();
      const row = await run(ctx, (tx) =>
        portfoliosRepo.insert(tx, ctx, id, {
          name: data.name,
          color: data.color,
          currency: data.currency,
          note: data.note ?? null,
          targets: data.targets ?? {},
        }),
      ).catch(uniqueName);
      await recordAudit(identity, ctx, 'portfolio.created', { target: id, ip: ipOf(headers) });
      // A new portfolio has no operations.
      return PortfolioDto.parse(toPortfolioDto(row, { opsCount: 0, plansCount: 0 }));
    },

    async update(headers, poolId, id, input) {
      const session = await requireSession(auth, headers);
      const parsed = UpdatePortfolioInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'portfolios.write');
      const portfolioId = parseId(id);
      const data = parsed.data;
      const dto = await run(ctx, async (tx) => {
        const current = await portfoliosRepo.find(tx, ctx, portfolioId);
        if (!current) throw new NotFoundError();
        const row = await portfoliosRepo.update(tx, ctx, portfolioId, {
          name: data.name ?? current.name,
          color: data.color ?? current.color,
          currency: data.currency ?? current.currency,
          note: data.note === undefined ? current.note : data.note,
          targets: data.targets ?? (current.targets as Record<string, unknown>),
        });
        if (!row) throw new NotFoundError();
        return toPortfolioDto(row, await countsOf(tx, ctx, portfolioId));
      }).catch(uniqueName);
      await recordAudit(identity, ctx, 'portfolio.updated', {
        target: portfolioId,
        ip: ipOf(headers),
      });
      return PortfolioDto.parse(dto);
    },

    async remove(headers, poolId, id, query = {}) {
      const session = await requireSession(auth, headers);
      const parsed = DeletePortfolioQuery.safeParse(query);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'portfolios.write');
      const portfolioId = parseId(id);
      const moveTo = parsed.data.moveTo?.toLowerCase();
      const deleteOps = parsed.data.deleteOps === 'true';
      if (moveTo && deleteOps) {
        throw invalid('moveTo', 'choose one: move the operations and plans or delete them');
      }
      if (moveTo === portfolioId) throw invalid('moveTo', 'must be another portfolio');
      await run(ctx, async (tx) => {
        if (!(await portfoliosRepo.find(tx, ctx, portfolioId))) throw new NotFoundError();
        const { opsCount, plansCount } = await countsOf(tx, ctx, portfolioId);
        const movesCount = await portfolioCashMovesRepo.count(tx, ctx, portfolioId);
        if (opsCount + plansCount + movesCount > 0) {
          if (moveTo) {
            if (!(await portfoliosRepo.find(tx, ctx, moveTo))) {
              throw invalid('moveTo', 'not a portfolio of this pool');
            }
            await investmentOpsRepo.moveAll(tx, ctx, portfolioId, moveTo);
            await plansRepo.moveAll(tx, ctx, portfolioId, moveTo);
            await portfolioCashMovesRepo.moveAll(tx, ctx, portfolioId, moveTo);
          } else if (deleteOps) {
            await investmentOpsRepo.removeAll(tx, ctx, portfolioId);
            await plansRepo.removeAll(tx, ctx, portfolioId);
          } else {
            throw new ConflictError(
              'This portfolio has operations or plans. Move or delete them first.',
            );
          }
        }
        await portfoliosRepo.remove(tx, ctx, portfolioId);
      }).catch((error: unknown) => {
        // An operation added between the count and the delete: the restrict FK says no.
        if (isForeignKeyViolation(error)) {
          throw new ConflictError(
            'This portfolio has operations or plans. Move or delete them first.',
          );
        }
        throw error;
      });
      await recordAudit(identity, ctx, 'portfolio.deleted', {
        target: portfolioId,
        ip: ipOf(headers),
      });
    },

    async summary(headers, poolId, query = {}) {
      const session = await requireSession(auth, headers);
      const parsed = SummaryQuery.safeParse(query);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const asOf = parsed.data.asOf ?? today();
      const portfolioId = parsed.data.portfolioId?.toLowerCase();
      const { summary, rates } = await run(ctx, async (tx) => {
        if (portfolioId && !(await portfoliosRepo.find(tx, ctx, portfolioId))) {
          throw new NotFoundError();
        }
        return loadSummary(tx, ctx, asOf, portfolioId);
      });
      return PortfolioSummaryDto.parse(toSummaryDto(summary, asOf, portfolioId ?? null, rates));
    },

    async view(headers, poolId, query = {}) {
      const session = await requireSession(auth, headers);
      const parsed = SummaryQuery.safeParse(query);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const asOf = parsed.data.asOf ?? today();
      const portfolioId = parsed.data.portfolioId?.toLowerCase() ?? null;
      return run(ctx, async (tx) => {
        if (portfolioId && !(await portfoliosRepo.find(tx, ctx, portfolioId))) {
          throw new NotFoundError();
        }
        const [opRows, assetRows, prices, resolved] = await Promise.all([
          investmentOpsRepo.list(tx, ctx),
          assetsRepo.list(tx, ctx),
          assetPricesRepo.latestAsOf(tx, ctx, asOf),
          loadFxRates(tx, ctx, asOf),
        ]);
        const latest = new Map(prices.map((price) => [price.assetId, price.price]));
        const assets = assetRows.map((row) => ({
          id: row.id,
          currency: row.currency,
          price: latest.get(row.id) ?? '0',
          dps: row.dps,
          divMonths: row.divMonths,
          type: row.type,
          sector: row.sector,
          region: row.region,
        }));
        const historicPrices = new Map<string, Map<string, string>>();
        // Only the months since the first operation are charted, so only those need prices.
        const firstMonth = opRows.reduce(
          (first, row) => (row.date.slice(0, 7) < first ? row.date.slice(0, 7) : first),
          asOf.slice(0, 7),
        );
        for (const month of lastMonths(PERFORMANCE_MONTHS, asOf).filter((m) => m >= firstMonth)) {
          const end = month === asOf.slice(0, 7) ? asOf : monthEnd(month);
          const rows = end === asOf ? prices : await assetPricesRepo.latestAsOf(tx, ctx, end);
          historicPrices.set(month, new Map(rows.map((row) => [row.assetId, row.price])));
        }
        return PortfolioViewDto.parse(
          buildPortfolioView({
            asOf,
            portfolioId,
            opRows,
            assets,
            rates: toFxRates(resolved),
            historicPrices,
          }),
        );
      });
    },
  };
}
