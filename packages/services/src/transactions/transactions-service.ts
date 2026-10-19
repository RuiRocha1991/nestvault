import {
  accountsRepo,
  categoriesRepo,
  isUuid,
  newId,
  transactionsRepo,
  withPool,
  type IdentityDatabase,
  type PoolContext,
  type PoolRunner,
  type PoolTx,
  type TransactionRow,
} from '@nestvault/db';
import { applyRules, detectTransfers, toPlain } from '@nestvault/domain';

import { recordAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { NotFoundError, ValidationError } from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';
import { clientIpResolver } from '../rate-limit/client-ip';

import { loadEngineContext, toEngineTransaction, type EngineContext } from './engine';
import {
  CreateTransactionInput,
  decodeCursor,
  encodeCursor,
  ListTransactionsQuery,
  monthRange,
  toTransactionDto,
  TransactionDto,
  TransactionPageDto,
  UpdateTransactionInput,
} from './schemas';

export interface TransactionsService {
  /** A page of the pool's movements, filtered and sorted by allow-listed keys (any member). */
  list(headers: Headers, poolId: string, query?: unknown): Promise<TransactionPageDto>;
  /** Records a movement by hand (`transactions.write`); the rules and transfer detection run after it. */
  create(headers: Headers, poolId: string, input: unknown): Promise<TransactionDto>;
  /** Sets the category by hand and/or fixes the transfer flag (`transactions.write`). */
  update(headers: Headers, poolId: string, id: string, input: unknown): Promise<TransactionDto>;
  /** Deletes a movement, releasing the other side of its transfer (`transactions.write`). */
  remove(headers: Headers, poolId: string, id: string): Promise<void>;
}

export interface TransactionsServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  trustedProxyHops?: number;
}

const invalid = (path: string, message: string) =>
  new ValidationError('The request is not valid.', [{ path, message }]);

const DAY_MS = 24 * 3600 * 1000;
const shiftDay = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

export function createTransactionsService(deps: TransactionsServiceDeps): TransactionsService {
  const { auth, identity } = deps;
  const run = deps.run ?? withPool;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);

  const parseId = (id: string) => {
    if (!isUuid(id)) throw new NotFoundError();
    return id.toLowerCase();
  };

  /** The category must be one the pool sees (global or its own). */
  async function assertCategory(tx: PoolTx, ctx: PoolContext, id: string) {
    if (!(await categoriesRepo.find(tx, ctx, id))) {
      throw invalid('categoryId', 'not a category of this pool');
    }
  }

  /** Pairs the new movement with the inflow or outflow that mirrors it, inside the pool's window. */
  async function detectAround(
    tx: PoolTx,
    ctx: PoolContext,
    engine: EngineContext,
    row: TransactionRow,
  ) {
    const window = await transactionsRepo.window(
      tx,
      ctx,
      shiftDay(row.date, -engine.days),
      shiftDay(row.date, engine.days),
    );
    const pairs = detectTransfers(
      window.map(toEngineTransaction),
      engine.transferAccounts,
      engine.categories,
      { days: engine.days },
    ).filter((pair) => pair.outflowId === row.id || pair.inflowId === row.id);
    for (const pair of pairs) await transactionsRepo.pair(tx, ctx, pair);
  }

  async function readOne(tx: PoolTx, ctx: PoolContext, id: string): Promise<TransactionDto> {
    const [row, engine] = await Promise.all([
      transactionsRepo.find(tx, ctx, id),
      loadEngineContext(tx, ctx),
    ]);
    if (!row) throw new NotFoundError();
    return TransactionDto.parse(toTransactionDto(row, engine.categories));
  }

  return {
    async list(headers, poolId, query = {}) {
      const session = await requireSession(auth, headers);
      const parsed = ListTransactionsQuery.safeParse(query);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const q = parsed.data;
      const cursor = q.cursor ? decodeCursor(q.cursor, q.sort, q.order) : null;
      if (q.cursor && !cursor) throw invalid('cursor', 'not a cursor of this list');
      const range = q.month ? monthRange(q.month) : {};
      const { page, categories } = await run(ctx, async (tx) => ({
        page: await transactionsRepo.list(
          tx,
          ctx,
          {
            ...range,
            ...(q.accountId ? { accountId: q.accountId.toLowerCase() } : {}),
            ...(q.categoryId
              ? { categoryId: q.categoryId === 'none' ? 'none' : q.categoryId.toLowerCase() }
              : {}),
            ...(q.kind ? { kind: q.kind } : {}),
            ...(q.q ? { text: q.q } : {}),
            ...(q.withNotes ? { withNotes: true } : {}),
          },
          { by: q.sort, descending: q.order === 'desc' },
          cursor,
          q.limit,
        ),
        categories: (await loadEngineContext(tx, ctx)).categories,
      }));
      return TransactionPageDto.parse({
        transactions: page.rows.map((row) => toTransactionDto(row, categories)),
        nextCursor: page.next ? encodeCursor({ ...page.next, sort: q.sort, order: q.order }) : null,
      });
    },

    async create(headers, poolId, input) {
      const session = await requireSession(auth, headers);
      const parsed = CreateTransactionInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'transactions.write');
      const data = parsed.data;
      const accountId = data.accountId.toLowerCase();
      const categoryId = data.categoryId?.toLowerCase() ?? null;
      const id = newId();
      await run(ctx, async (tx) => {
        if (!(await accountsRepo.find(tx, ctx, accountId))) {
          throw invalid('accountId', 'not an account of this pool');
        }
        if (categoryId) await assertCategory(tx, ctx, categoryId);
        const engine = await loadEngineContext(tx, ctx);
        const amount = toPlain(data.amount);
        // A category given by hand is final; otherwise the household's rules choose one.
        const decided = categoryId
          ? null
          : applyRules(
              {
                id,
                accountId,
                date: data.date,
                amount,
                description: data.description,
              },
              engine.rules,
            );
        const row = await transactionsRepo.insert(tx, ctx, id, {
          accountId,
          date: data.date,
          description: data.description,
          amount,
          categoryId: categoryId ?? decided?.categoryId ?? null,
          transfer: decided?.transfer ?? false,
          transferLocked: false,
          manualCategory: categoryId !== null,
          // Movements written by hand have no statement line to deduplicate against.
          hash: `manual:${id}`,
        });
        await detectAround(tx, ctx, engine, row);
      });
      await recordAudit(identity, ctx, 'transaction.created', { target: id, ip: ipOf(headers) });
      return run(ctx, (tx) => readOne(tx, ctx, id));
    },

    async update(headers, poolId, id, input) {
      const session = await requireSession(auth, headers);
      const parsed = UpdateTransactionInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'transactions.write');
      const transactionId = parseId(id);
      const data = parsed.data;
      await run(ctx, async (tx) => {
        const current = await transactionsRepo.find(tx, ctx, transactionId);
        if (!current) throw new NotFoundError();
        const engine = await loadEngineContext(tx, ctx);

        if (data.categoryId !== undefined) {
          if (data.categoryId === null) {
            // Back to the rules: the manual choice is dropped and the rules decide again.
            const decided = applyRules(
              toEngineTransaction({ ...current, manualCategory: false }),
              engine.rules,
            );
            await transactionsRepo.update(tx, ctx, transactionId, {
              categoryId: decided?.categoryId ?? null,
              manualCategory: false,
              ...(decided?.transfer != null ? { transfer: decided.transfer } : {}),
            });
          } else {
            const categoryId = data.categoryId.toLowerCase();
            await assertCategory(tx, ctx, categoryId);
            const kind = engine.categories.find((category) => category.id === categoryId)?.kind;
            await transactionsRepo.update(tx, ctx, transactionId, {
              categoryId,
              manualCategory: true,
              // Choosing the transfer category by hand makes it a transfer.
              ...(kind === 'transfer' && !current.transferLocked ? { transfer: true } : {}),
            });
          }
        }

        if (data.transfer !== undefined) {
          await transactionsRepo.update(tx, ctx, transactionId, {
            transfer: data.transfer,
            transferLocked: true,
          });
          // Saying it is not a transfer releases the other side too.
          if (!data.transfer && current.pairId) {
            await transactionsRepo.update(tx, ctx, current.pairId, { pairId: null });
            await transactionsRepo.update(tx, ctx, transactionId, { pairId: null });
          }
        }
      });
      await recordAudit(identity, ctx, 'transaction.updated', {
        target: transactionId,
        ip: ipOf(headers),
      });
      return run(ctx, (tx) => readOne(tx, ctx, transactionId));
    },

    async remove(headers, poolId, id) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'transactions.write');
      const transactionId = parseId(id);
      await run(ctx, async (tx) => {
        if (!(await transactionsRepo.find(tx, ctx, transactionId))) throw new NotFoundError();
        // The other side of a transfer must not keep pointing at a movement that is gone.
        await transactionsRepo.unpairPartner(tx, ctx, transactionId);
        await transactionsRepo.remove(tx, ctx, transactionId);
      });
      await recordAudit(identity, ctx, 'transaction.deleted', {
        target: transactionId,
        ip: ipOf(headers),
      });
    },
  };
}
