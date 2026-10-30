import {
  accountsRepo,
  lockPoolResource,
  PLANS,
  poolMembersRepo,
  poolSubscriptionsRepo,
  portfoliosRepo,
  withPool,
  type IdentityDatabase,
  type IdentityExecutor,
  type Plan,
  type PoolContext,
  type PoolRunner,
  type PoolTx,
} from '@nestvault/db';

import type { Auth } from '../auth/create-auth';
import { requireSession } from '../auth/require-session';
import { PlanLimitError } from '../errors';
import { can, requirePoolAccess } from '../guards/pool-access';

import { PLAN_FEATURES, PLAN_LIMITS, type Feature, type LimitedResource } from './plans';
import { PoolPlanDto } from './schemas';

export interface Entitlements {
  /** The pool's plan: Pro for every pool while billing is off; otherwise Free without an active subscription. */
  planOf(ctx: PoolContext): Promise<Plan>;
  /** Throws `PlanLimitError` unless the pool's plan includes `feature`. */
  assertFeature(ctx: PoolContext, feature: Feature): Promise<void>;
  /**
   * Throws `PlanLimitError` when the pool already uses all it may of `resource`. Call it inside the
   * transaction that inserts: it takes a per-pool advisory lock first, so two parallel requests
   * cannot both pass. `accounts` and `portfolios` count in the app database, `members` in identity.
   */
  assertWithinLimit(
    ctx: PoolContext,
    resource: 'accounts' | 'portfolios',
    tx: PoolTx,
  ): Promise<void>;
  assertWithinLimit(ctx: PoolContext, resource: 'members', tx: IdentityExecutor): Promise<void>;
}

export interface EntitlementsService extends Entitlements {
  /** Plan, limits, usage and features of the pool (any member). */
  get(headers: Headers, poolId: string): Promise<PoolPlanDto>;
}

export interface EntitlementsDeps {
  identity: IdentityDatabase;
  /** `BILLING_ENABLED`: when false every pool is Pro. */
  billingEnabled: boolean;
}

export interface EntitlementsServiceDeps extends EntitlementsDeps {
  auth: Auth;
  run?: PoolRunner;
}

const COUNTERS = {
  accounts: (tx: PoolTx, ctx: PoolContext) => accountsRepo.count(tx, ctx),
  portfolios: (tx: PoolTx, ctx: PoolContext) => portfoliosRepo.count(tx, ctx),
} as const;

export function createEntitlements(deps: EntitlementsDeps): Entitlements {
  const { identity, billingEnabled } = deps;

  async function planOf(ctx: PoolContext): Promise<Plan> {
    if (!billingEnabled) return 'pro';
    const subscription = await poolSubscriptionsRepo.find(identity.db, ctx.poolId);
    if (!subscription || subscription.status === 'canceled') return 'free';
    return PLANS.find((plan) => plan === subscription.plan) ?? 'free';
  }

  async function assertFeature(ctx: PoolContext, feature: Feature): Promise<void> {
    if (!PLAN_FEATURES[await planOf(ctx)][feature]) throw new PlanLimitError(feature, null);
  }

  async function assertWithinLimit(
    ctx: PoolContext,
    resource: LimitedResource,
    tx: PoolTx | IdentityExecutor,
  ): Promise<void> {
    const limit = PLAN_LIMITS[await planOf(ctx)][resource];
    if (limit === null) return;
    await lockPoolResource(tx, ctx.poolId, resource);
    const used =
      resource === 'members'
        ? await poolMembersRepo.count(tx, ctx.poolId)
        : await COUNTERS[resource](tx as PoolTx, ctx);
    if (used >= limit) throw new PlanLimitError(resource, limit);
  }

  return { planOf, assertFeature, assertWithinLimit: assertWithinLimit };
}

export function createEntitlementsService(deps: EntitlementsServiceDeps): EntitlementsService {
  const { auth, identity, billingEnabled } = deps;
  const run = deps.run ?? withPool;
  const entitlements = createEntitlements({ identity, billingEnabled });

  return {
    ...entitlements,

    async get(headers, poolId) {
      const session = await requireSession(auth, headers);
      const ctx = await requirePoolAccess(identity, session, poolId);
      can(ctx, 'pool.read');
      const plan = await entitlements.planOf(ctx);
      const [accounts, portfolios] = await run(ctx, async (tx) => [
        await accountsRepo.count(tx, ctx),
        await portfoliosRepo.count(tx, ctx),
      ]);
      const members = await poolMembersRepo.count(identity.db, ctx.poolId);
      return PoolPlanDto.parse({
        plan,
        billingEnabled,
        limits: PLAN_LIMITS[plan],
        usage: { accounts, portfolios, members },
        features: PLAN_FEATURES[plan],
      });
    },
  };
}
