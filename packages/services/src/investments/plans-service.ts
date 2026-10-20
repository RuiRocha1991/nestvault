import {
  assetPricesRepo,
  investmentOpsRepo,
  newId,
  plansRepo,
  withPool,
  type IdentityDatabase,
  type PlanRow,
  type PlanValues,
  type PoolRunner,
} from '@nestvault/db';
import { dec, roundTo, toPlain } from '@nestvault/domain';

import { recordAudit } from '../audit/audit';
import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { isUniqueViolation } from '../db-errors';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';
import { clientIpResolver } from '../rate-limit/client-ip';

import {
  assertPlacement,
  assertPortfolioAndAsset,
  invalid,
  parseId,
  refOrRethrow,
  resolvePlacement,
} from './checks';
import {
  CreatePlanInput,
  ListPlansQuery,
  PlanDto,
  PlanListDto,
  PlanRunDto,
  RunPlanInput,
  toOpDto,
  toPlanDto,
  UpdatePlanInput,
} from './schemas';

export interface PlansService {
  /** Plans of the pool, optionally of one portfolio (any member). */
  list(headers: Headers, poolId: string, query?: unknown): Promise<PlanListDto>;
  /** One plan (any member). */
  get(headers: Headers, poolId: string, id: string): Promise<PlanDto>;
  /** Creates a plan (`portfolios.write`). */
  create(headers: Headers, poolId: string, input: unknown): Promise<PlanDto>;
  /** Changes a plan; fields left out stay (`portfolios.write`). */
  update(headers: Headers, poolId: string, id: string, input: unknown): Promise<PlanDto>;
  /** Deletes a plan; the buys it created stay (`portfolios.write`). */
  remove(headers: Headers, poolId: string, id: string): Promise<void>;
  /**
   * Registers the plan's buy for a month (the current one by default, never a later one;
   * `ops.write`). The plan's amount is in the asset's currency. Running it again for the same month
   * creates nothing and returns the buy that exists.
   */
  run(headers: Headers, poolId: string, id: string, input?: unknown): Promise<PlanRunDto>;
}

export interface PlansServiceDeps {
  auth: Auth;
  identity: IdentityDatabase;
  /** Runs work inside `withPool`; tests pass their own database. */
  run?: PoolRunner;
  trustedProxyHops?: number;
  now?: () => Date;
}

const toValues = (row: PlanRow): PlanValues => ({
  portfolioId: row.portfolioId,
  assetId: row.assetId,
  accountId: row.accountId,
  subAccountId: row.subAccountId,
  amount: row.amount,
  day: row.day,
  active: row.active,
});

export function createPlansService(deps: PlansServiceDeps): PlansService {
  const { auth, identity } = deps;
  const run = deps.run ?? withPool;
  const ipOf = clientIpResolver(deps.trustedProxyHops ?? 0);
  const now = deps.now ?? (() => new Date());
  const today = () => now().toISOString().slice(0, 10);

  return {
    async list(headers, poolId, query = {}) {
      const session = await requireSession(auth, headers);
      const parsed = ListPlansQuery.safeParse(query);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const rows = await run(ctx, (tx) =>
        plansRepo.list(tx, ctx, parsed.data.portfolioId?.toLowerCase()),
      );
      return PlanListDto.parse({ plans: rows.map(toPlanDto) });
    },

    async get(headers, poolId, id) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const row = await run(ctx, (tx) => plansRepo.find(tx, ctx, parseId(id)));
      if (!row) throw new NotFoundError();
      return PlanDto.parse(toPlanDto(row));
    },

    async create(headers, poolId, input) {
      const session = await requireSession(auth, headers);
      const parsed = CreatePlanInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'portfolios.write');
      const data = parsed.data;
      const id = newId();
      const values: PlanValues = {
        portfolioId: data.portfolioId.toLowerCase(),
        assetId: data.assetId.toLowerCase(),
        accountId: data.accountId?.toLowerCase() ?? null,
        subAccountId: data.subAccountId?.toLowerCase() ?? null,
        amount: data.amount,
        day: data.day,
        active: data.active ?? true,
      };
      const row = await run(ctx, async (tx) => {
        await assertPortfolioAndAsset(tx, ctx, values.portfolioId, values.assetId);
        await assertPlacement(tx, ctx, values.accountId, values.subAccountId);
        return plansRepo.insert(tx, ctx, id, values);
      }).catch(refOrRethrow);
      await recordAudit(identity, ctx, 'plan.created', { target: id, ip: ipOf(headers) });
      return PlanDto.parse(toPlanDto(row));
    },

    async update(headers, poolId, id, input) {
      const session = await requireSession(auth, headers);
      const parsed = UpdatePlanInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'portfolios.write');
      const planId = parseId(id);
      const data = parsed.data;
      const row = await run(ctx, async (tx) => {
        const current = await plansRepo.find(tx, ctx, planId);
        if (!current) throw new NotFoundError();
        const base = toValues(current);
        const values: PlanValues = {
          portfolioId: data.portfolioId?.toLowerCase() ?? base.portfolioId,
          assetId: data.assetId?.toLowerCase() ?? base.assetId,
          ...resolvePlacement(base, data),
          amount: data.amount ?? base.amount,
          day: data.day ?? base.day,
          active: data.active ?? base.active,
        };
        await assertPortfolioAndAsset(tx, ctx, values.portfolioId, values.assetId);
        await assertPlacement(tx, ctx, values.accountId, values.subAccountId);
        const updated = await plansRepo.update(tx, ctx, planId, values);
        if (!updated) throw new NotFoundError();
        return updated;
      }).catch(refOrRethrow);
      await recordAudit(identity, ctx, 'plan.updated', { target: planId, ip: ipOf(headers) });
      return PlanDto.parse(toPlanDto(row));
    },

    async remove(headers, poolId, id) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'portfolios.write');
      const planId = parseId(id);
      const removed = await run(ctx, (tx) => plansRepo.remove(tx, ctx, planId));
      if (!removed) throw new NotFoundError();
      await recordAudit(identity, ctx, 'plan.deleted', { target: planId, ip: ipOf(headers) });
    },

    async run(headers, poolId, id, input = {}) {
      const session = await requireSession(auth, headers);
      const parsed = RunPlanInput.safeParse(input);
      if (!parsed.success) throw new ValidationError();
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'ops.write');
      const planId = parseId(id);
      const thisMonth = today().slice(0, 7);
      const month = parsed.data.month ?? thisMonth;
      if (month > thisMonth) throw invalid('month', 'cannot be a month that has not started');
      const outcome = await run(ctx, async (tx) => {
        const plan = await plansRepo.find(tx, ctx, planId);
        if (!plan) throw new NotFoundError();
        const existing = await investmentOpsRepo.findByPlanPeriod(tx, ctx, planId, month);
        if (existing) return { created: false, row: existing };
        if (!plan.active) throw new ConflictError('This plan is not active.');
        // Bought on the plan's day, but never dated in the future.
        const day = `${month}-${String(plan.day).padStart(2, '0')}`;
        const date = day > today() ? today() : day;
        const priced = await assetPricesRepo.latestFor(tx, ctx, plan.assetId, date);
        if (!priced || !dec(priced.price).gt(0)) {
          throw invalid('assetId', 'the asset has no price for this date');
        }
        const qty = roundTo(dec(plan.amount).div(priced.price), 8);
        if (!qty.gt(0)) throw invalid('amount', 'too small to buy any quantity at this price');
        const row = await investmentOpsRepo.insert(tx, ctx, newId(), {
          portfolioId: plan.portfolioId,
          assetId: plan.assetId,
          accountId: plan.accountId,
          subAccountId: plan.subAccountId,
          type: 'buy',
          date,
          qty: toPlain(qty),
          price: priced.price,
          fee: null,
          amount: null,
          gross: null,
          tax: null,
          fromCash: false,
          planId,
          planPeriod: month,
          extId: null,
          note: null,
        });
        return { created: true, row };
      }).catch(async (error: unknown) => {
        // Two runs at once: the second one loses the unique index and returns the first one's buy.
        if (!isUniqueViolation(error)) throw error;
        const row = await run(ctx, (tx) =>
          investmentOpsRepo.findByPlanPeriod(tx, ctx, planId, month),
        );
        if (!row) throw error;
        return { created: false, row };
      });
      if (outcome.created) {
        await recordAudit(identity, ctx, 'plan.run', { target: planId, ip: ipOf(headers) });
      }
      return PlanRunDto.parse({ created: outcome.created, op: toOpDto(outcome.row) });
    },
  };
}
