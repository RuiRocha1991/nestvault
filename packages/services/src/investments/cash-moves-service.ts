import {
  accountsRepo,
  assetsRepo,
  investmentOpsRepo,
  newId,
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
  cashShortfall,
  dec,
  findCategoryByKind,
  moveAmountInAccountCurrency,
  portfolioCash,
  toFxRates,
  toPlain,
} from '@nestvault/domain';

import { recordAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { NotFoundError, ValidationError } from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';
import { clientIpResolver } from '../rate-limit/client-ip';
import { loadFxRates } from '../settings/fx';
import { loadEngineContext } from '../transactions/engine';

import { linkCashMoves } from './cash-moves-match';
import { invalid, parseId, refOrRethrow } from './checks';
import { toCashMove, toInvestmentOp } from './domain';
import { CashMoveDto, CashMoveListDto, MoveCashInput, toCashMoveDto } from './schemas';

/** Accounts that can receive portfolio cash: current and savings accounts. */
const RECEIVING_TYPES: ReadonlySet<string> = new Set(['checking', 'savings']);

export interface CashMovesService {
  /** The cash moves of a portfolio, newest first (any member). */
  list(headers: Headers, poolId: string, portfolioId: string): Promise<CashMoveListDto>;
  /**
   * Moves cash from the portfolio to a bank account (`ops.write`). The amount may not exceed the
   * portfolio cash on the date (400). With `mirror=true` the matching bank movement is recorded in
   * the same database transaction; otherwise the statement import brings it and it is matched later.
   */
  create(
    headers: Headers,
    poolId: string,
    portfolioId: string,
    input: unknown,
  ): Promise<CashMoveDto>;
  /** Undoes a move; the bank movement it created (the mirror) is deleted with it (`ops.write`). */
  remove(headers: Headers, poolId: string, portfolioId: string, id: string): Promise<void>;
}

export interface CashMovesServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  trustedProxyHops?: number;
}

export function createCashMovesService(deps: CashMovesServiceDeps): CashMovesService {
  const { auth, identity } = deps;
  const run = deps.run ?? withPool;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);

  /** Cash the portfolio holds on `asOf`, in EUR, and the rates to convert to the account. */
  async function cashOn(tx: PoolTx, ctx: PoolContext, portfolioId: string, asOf: string) {
    const [opRows, assetRows, accountRows, moveRows, resolved] = await Promise.all([
      investmentOpsRepo.list(tx, ctx, { portfolioId }),
      assetsRepo.list(tx, ctx),
      accountsRepo.list(tx, ctx),
      portfolioCashMovesRepo.list(tx, ctx, { portfolioId }),
      loadFxRates(tx, ctx, asOf),
    ]);
    const rates = toFxRates(resolved);
    const cash = portfolioCash(
      opRows.map(toInvestmentOp),
      moveRows.map(toCashMove),
      accountRows.map((row) => ({ id: row.id, trackCash: row.trackCash })),
      assetRows.map((row) => ({
        id: row.id,
        currency: row.currency,
        price: '0',
        dps: row.dps,
        divMonths: row.divMonths,
      })),
      rates,
      { asOf, portfolioIds: [portfolioId] },
    );
    return { cash, rates };
  }

  return {
    async list(headers, poolId, portfolioId) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const id = parseId(portfolioId);
      const rows = await run(ctx, async (tx) => {
        if (!(await portfoliosRepo.find(tx, ctx, id))) throw new NotFoundError();
        return portfolioCashMovesRepo.list(tx, ctx, { portfolioId: id });
      });
      return CashMoveListDto.parse({ moves: rows.map(toCashMoveDto) });
    },

    async create(headers, poolId, portfolioId, input) {
      const session = await requireSession(auth, headers);
      const parsed = MoveCashInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'ops.write');
      const pfId = parseId(portfolioId);
      const data = parsed.data;
      const accountId = data.accountId.toLowerCase();
      const id = newId();
      const row = await run(ctx, async (tx) => {
        const portfolio = await portfoliosRepo.find(tx, ctx, pfId);
        if (!portfolio) throw new NotFoundError();
        const account = await accountsRepo.find(tx, ctx, accountId);
        if (!account) throw invalid('accountId', 'not an account of this pool');
        if (!RECEIVING_TYPES.has(account.type)) {
          throw invalid('accountId', 'must be a checking or savings account');
        }

        const { cash, rates } = await cashOn(tx, ctx, pfId, data.date);
        if (cashShortfall(cash, data.amount)) {
          throw invalid('amount', 'more than the cash available in the portfolio');
        }

        let transactionId: string | null = null;
        if (data.mirror === true) {
          const engine = await loadEngineContext(tx, ctx);
          transactionId = newId();
          // The mirror is the inflow of the transfer: flagged and locked so no outflow is paired
          // with it and the household's rules leave it alone.
          await transactionsRepo.insert(tx, ctx, transactionId, {
            accountId,
            date: data.date,
            description: `Portfolio cash move: ${portfolio.name}`,
            amount: toPlain(moveAmountInAccountCurrency(data.amount, account.currency, rates)),
            categoryId: findCategoryByKind(engine.categories, 'transfer')?.id ?? null,
            transfer: true,
            transferLocked: true,
            manualCategory: false,
            hash: `cashmove:${id}`,
          });
        }
        const inserted = await portfolioCashMovesRepo.insert(tx, ctx, id, {
          portfolioId: pfId,
          accountId,
          date: data.date,
          // Stored signed like the domain's moves: cash leaving the portfolio is negative.
          amount: toPlain(dec(data.amount).neg()),
          note: data.note ?? null,
          transactionId,
          mirror: transactionId !== null,
        });
        // Without a mirror, a line the statement import already brought is recognised now.
        if (transactionId === null) await linkCashMoves(tx, ctx, data.date);
        return (await portfolioCashMovesRepo.find(tx, ctx, id)) ?? inserted;
      }).catch(refOrRethrow);
      await recordAudit(identity, ctx, 'cashmove.created', { target: id, ip: ipOf(headers) });
      return CashMoveDto.parse(toCashMoveDto(row));
    },

    async remove(headers, poolId, portfolioId, id) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'ops.write');
      const pfId = parseId(portfolioId);
      const moveId = parseId(id);
      await run(ctx, async (tx) => {
        const move = await portfolioCashMovesRepo.find(tx, ctx, moveId);
        if (!move || move.portfolioId !== pfId) throw new NotFoundError();
        await portfolioCashMovesRepo.remove(tx, ctx, moveId);
        // Only a movement this move created goes with it; an imported line stays.
        if (move.mirror && move.transactionId) {
          await transactionsRepo.remove(tx, ctx, move.transactionId);
        }
      });
      await recordAudit(identity, ctx, 'cashmove.deleted', { target: moveId, ip: ipOf(headers) });
    },
  };
}
