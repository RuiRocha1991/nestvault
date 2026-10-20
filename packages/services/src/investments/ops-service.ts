import {
  investmentOpsRepo,
  newId,
  withPool,
  type IdentityDatabase,
  type InvestmentOpRow,
  type InvestmentOpValues,
  type PoolRunner,
} from '@nestvault/db';

import { recordAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { NotFoundError, ValidationError } from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';
import { clientIpResolver } from '../rate-limit/client-ip';

import {
  assertPlacement,
  assertPortfolioAndAsset,
  normalizeOp,
  parseId,
  refOrRethrow,
  resolvePlacement,
} from './checks';
import { CreateOpInput, ListOpsQuery, OpDto, OpListDto, toOpDto, UpdateOpInput } from './schemas';

export interface OpsService {
  /** Operations of the pool, newest first, with optional filters (any member). */
  list(headers: Headers, poolId: string, query?: unknown): Promise<OpListDto>;
  /** One operation (any member). */
  get(headers: Headers, poolId: string, id: string): Promise<OpDto>;
  /** Records a buy, a sell or a dividend (`ops.write`). */
  create(headers: Headers, poolId: string, input: unknown): Promise<OpDto>;
  /** Changes an operation; fields left out stay (`ops.write`). */
  update(headers: Headers, poolId: string, id: string, input: unknown): Promise<OpDto>;
  /** Deletes an operation (`ops.write`). */
  remove(headers: Headers, poolId: string, id: string): Promise<void>;
}

export interface OpsServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  trustedProxyHops?: number;
}

const toValues = (row: InvestmentOpRow): InvestmentOpValues => ({
  portfolioId: row.portfolioId,
  assetId: row.assetId,
  accountId: row.accountId,
  subAccountId: row.subAccountId,
  type: row.type as InvestmentOpValues['type'],
  date: row.date,
  qty: row.qty,
  price: row.price,
  fee: row.fee,
  amount: row.amount,
  gross: row.gross,
  tax: row.tax,
  fromCash: row.fromCash,
  planId: row.planId,
  planPeriod: row.planPeriod,
  extId: row.extId,
  note: row.note,
});

export function createOpsService(deps: OpsServiceDeps): OpsService {
  const { auth, identity } = deps;
  const run = deps.run ?? withPool;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);

  return {
    async list(headers, poolId, query = {}) {
      const session = await requireSession(auth, headers);
      const parsed = ListOpsQuery.safeParse(query);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const q = parsed.data;
      const rows = await run(ctx, (tx) =>
        investmentOpsRepo.list(tx, ctx, {
          limit: q.limit,
          ...(q.portfolioId ? { portfolioId: q.portfolioId.toLowerCase() } : {}),
          ...(q.assetId ? { assetId: q.assetId.toLowerCase() } : {}),
          ...(q.accountId ? { accountId: q.accountId.toLowerCase() } : {}),
          ...(q.type ? { type: q.type } : {}),
          ...(q.from ? { from: q.from } : {}),
          ...(q.to ? { to: q.to } : {}),
        }),
      );
      return OpListDto.parse({ ops: rows.map(toOpDto) });
    },

    async get(headers, poolId, id) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const opId = parseId(id);
      const row = await run(ctx, (tx) => investmentOpsRepo.find(tx, ctx, opId));
      if (!row) throw new NotFoundError();
      return OpDto.parse(toOpDto(row));
    },

    async create(headers, poolId, input) {
      const session = await requireSession(auth, headers);
      const parsed = CreateOpInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'ops.write');
      const data = parsed.data;
      const id = newId();
      const row = await run(ctx, async (tx) => {
        const values = normalizeOp({
          portfolioId: data.portfolioId.toLowerCase(),
          assetId: data.assetId.toLowerCase(),
          accountId: data.accountId?.toLowerCase() ?? null,
          subAccountId: data.subAccountId?.toLowerCase() ?? null,
          type: data.type,
          date: data.date,
          qty: data.qty ?? null,
          price: data.price ?? null,
          fee: data.fee ?? null,
          amount: data.amount ?? null,
          gross: data.gross ?? null,
          tax: data.tax ?? null,
          fromCash: data.fromCash ?? false,
          planId: null,
          planPeriod: null,
          extId: null,
          note: data.note ?? null,
        });
        await assertPortfolioAndAsset(tx, ctx, values.portfolioId, values.assetId);
        await assertPlacement(tx, ctx, values.accountId, values.subAccountId);
        return investmentOpsRepo.insert(tx, ctx, id, values);
      }).catch(refOrRethrow);
      await recordAudit(identity, ctx, 'op.created', { target: id, ip: ipOf(headers) });
      return OpDto.parse(toOpDto(row));
    },

    async update(headers, poolId, id, input) {
      const session = await requireSession(auth, headers);
      const parsed = UpdateOpInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'ops.write');
      const opId = parseId(id);
      const data = parsed.data;
      const row = await run(ctx, async (tx) => {
        const current = await investmentOpsRepo.find(tx, ctx, opId);
        if (!current) throw new NotFoundError();
        const base = toValues(current);
        const pick = <K extends keyof InvestmentOpValues>(
          key: K,
          value: InvestmentOpValues[K] | undefined,
        ) => (value === undefined ? base[key] : value);
        const values = normalizeOp({
          ...base,
          portfolioId: data.portfolioId?.toLowerCase() ?? base.portfolioId,
          assetId: data.assetId?.toLowerCase() ?? base.assetId,
          ...resolvePlacement(base, data),
          type: data.type ?? base.type,
          date: data.date ?? base.date,
          qty: pick('qty', data.qty),
          price: pick('price', data.price),
          fee: pick('fee', data.fee),
          amount: pick('amount', data.amount),
          gross: pick('gross', data.gross),
          tax: pick('tax', data.tax),
          fromCash: data.fromCash ?? base.fromCash,
          note: pick('note', data.note),
        });
        await assertPortfolioAndAsset(tx, ctx, values.portfolioId, values.assetId);
        await assertPlacement(tx, ctx, values.accountId, values.subAccountId);
        const updated = await investmentOpsRepo.update(tx, ctx, opId, values);
        if (!updated) throw new NotFoundError();
        return updated;
      }).catch(refOrRethrow);
      await recordAudit(identity, ctx, 'op.updated', { target: opId, ip: ipOf(headers) });
      return OpDto.parse(toOpDto(row));
    },

    async remove(headers, poolId, id) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'ops.write');
      const opId = parseId(id);
      const removed = await run(ctx, (tx) => investmentOpsRepo.remove(tx, ctx, opId));
      if (!removed) throw new NotFoundError();
      await recordAudit(identity, ctx, 'op.deleted', { target: opId, ip: ipOf(headers) });
    },
  };
}
