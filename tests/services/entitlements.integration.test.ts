import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAccountsService,
  createEntitlements,
  createEntitlementsService,
  createInvitesService,
  createPortfoliosService,
  logger,
  NotFoundError,
  PlanLimitError,
  PoolPlanDto,
  requirePoolAccess,
  requireSession,
  UnauthorizedError,
  type AccountsService,
  type EntitlementsService,
  type InvitesService,
  type PortfoliosService,
} from '@nestvault/services';

import { createApiWorld, type ApiWorld, type Persona, type Scenario } from '../support/api-world';
import { APP_URL } from '../support/auth-harness';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let world: ApiWorld;
let s: Scenario;
// The same services as the world's, with billing switched on: a pool without a subscription is Free.
let accounts: AccountsService;
let portfolios: PortfoliosService;
let invites: InvitesService;
let plan: EntitlementsService;

beforeAll(async () => {
  logger.level = 'silent';
  world = await createApiWorld();
  const { auth, identity, database, limiter, mail } = world;
  const entitlements = createEntitlements({ identity, billingEnabled: true });
  const common = { auth, identity, entitlements, trustedProxyHops: 1 };
  accounts = createAccountsService({ ...common, run: database.withPool });
  portfolios = createPortfoliosService({ ...common, run: database.withPool });
  invites = createInvitesService({
    ...common,
    limiter,
    email: mail,
    appUrl: APP_URL,
    now: world.now,
  });
  plan = createEntitlementsService({
    auth,
    identity,
    billingEnabled: true,
    run: database.withPool,
  });
});

beforeEach(async () => {
  s = await world.newScenario();
});

afterAll(async () => {
  await world.close();
});

const holder = async () =>
  (await world.holders.list(await s.as('owner'), s.poolA)).holders[0]?.id ?? '';
const newAccount = async (service: AccountsService, name: string, as: Persona = 'owner') =>
  service.create(await s.as(as), s.poolA, {
    type: 'checking',
    name,
    currency: 'EUR',
    opening: '10',
    holderIds: [await holder()],
  });
const newPortfolio = async (service: PortfoliosService, name: string) =>
  service.create(await s.as('owner'), s.poolA, { name, color: '#112233', currency: 'EUR' });
const subscribe = (plan: string, status = 'active') =>
  world.identity.db.execute(
    sql`insert into pool_subscriptions (pool_id, plan, status) values (${s.poolA}, ${plan}, ${status})`,
  );
const count = async (table: 'accounts' | 'portfolios') =>
  (await world.database.withPool(await poolContext(), async (tx) => {
    const found = await tx.execute(sql`select count(*)::int as n from ${sql.identifier(table)}`);
    return found.rows[0]?.['n'];
  })) as number;

async function poolContext() {
  const session = await requireSession(world.auth, await s.as('owner'));
  return requirePoolAccess(world.identity, session, s.poolA);
}

const refused = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(PlanLimitError);
  return error as PlanLimitError;
};

describe('plan limits with billing on and no subscription (Free)', () => {
  it('lets 3 accounts in and refuses the 4th with plan_limit', async () => {
    for (const name of ['A1', 'A2', 'A3']) await newAccount(accounts, name);
    const error = await refused(newAccount(accounts, 'A4'));
    expect(error).toMatchObject({
      status: 403,
      code: 'plan_limit',
      resource: 'accounts',
      limit: 3,
    });
    expect(await count('accounts')).toBe(3);
  });

  it('lets 2 portfolios in and refuses the 3rd', async () => {
    await newPortfolio(portfolios, 'P1');
    await newPortfolio(portfolios, 'P2');
    expect(await refused(newPortfolio(portfolios, 'P3'))).toMatchObject({
      resource: 'portfolios',
      limit: 2,
    });
    expect(await count('portfolios')).toBe(2);
  });

  it('refuses any invite and leaves no invite and no email behind', async () => {
    const before = await s.stateDigest();
    const error = await refused(
      invites.create(await s.as('owner'), s.poolA, { email: 'novo@example.test', role: 'viewer' }),
    );
    expect(error).toMatchObject({ resource: 'members', limit: 1 });
    expect(await s.stateDigest()).toBe(before);
  });

  it('refuses to accept an invite: the person does not join and the invite stays open', async () => {
    // Made by the world's own service (billing off) so that only the accept is under test.
    const invite = await s.invite('A', s.emails.newcomer);
    await refused(invites.accept(await s.as('newcomer'), invite.token));
    expect(await s.roleOf(s.poolA, 'newcomer')).toBeUndefined();
    expect((await s.inviteRow(invite.id))?.['accepted_at']).toBeNull();
  });

  it('does not count holders without a login as members', async () => {
    await world.holders.create(await s.as('owner'), s.poolA, { name: 'Simão' });
    await world.holders.create(await s.as('owner'), s.poolA, { name: 'Beatriz' });
    const { usage } = await plan.get(await s.as('owner'), s.poolA);
    // owner, admin, member and viewer of the scenario; the two holders are not in the count.
    expect(usage.members).toBe(4);
  });

  it('keeps the other pool unaffected: its accounts do not use this pool’s room', async () => {
    for (const name of ['A1', 'A2', 'A3']) await newAccount(accounts, name);
    const other = await accounts.create(await s.as('outsider'), s.poolB, {
      type: 'checking',
      name: 'B1',
      currency: 'EUR',
      opening: '1',
      holderIds: [(await world.holders.list(await s.as('outsider'), s.poolB)).holders[0]?.id ?? ''],
    });
    expect(other.name).toBe('B1');
  });
});

describe('a Pro subscription', () => {
  it('lifts the limits, also when the payment is late', async () => {
    await subscribe('pro', 'past_due');
    for (const name of ['A1', 'A2', 'A3', 'A4']) await newAccount(accounts, name);
    for (const name of ['P1', 'P2', 'P3']) await newPortfolio(portfolios, name);
    const invite = await s.invite('A', s.emails.newcomer);
    await expect(invites.accept(await s.as('newcomer'), invite.token)).resolves.toEqual({
      poolId: s.poolA,
    });
  });

  it('is Free again once canceled', async () => {
    await subscribe('pro', 'canceled');
    for (const name of ['A1', 'A2', 'A3']) await newAccount(accounts, name);
    await refused(newAccount(accounts, 'A4'));
  });
});

describe('billing off (the default)', () => {
  it('limits nothing: every pool is Pro', async () => {
    for (const name of ['A1', 'A2', 'A3', 'A4']) await newAccount(world.accounts, name);
    for (const name of ['P1', 'P2', 'P3']) await newPortfolio(world.portfolios, name);
    const info = await world.entitlements.get(await s.as('owner'), s.poolA);
    expect(info).toMatchObject({ plan: 'pro', billingEnabled: false });
    expect(info.limits).toEqual({ accounts: null, portfolios: null, members: null });
  });

  it('ignores a Free row: the plan is Pro whatever the subscription says', async () => {
    await subscribe('free');
    const ctx = await poolContext();
    expect(
      await createEntitlements({ identity: world.identity, billingEnabled: false }).planOf(ctx),
    ).toBe('pro');
  });
});

describe('race: count and insert are one step', () => {
  it('10 parallel account creations on a Free pool with 2 accounts give exactly 1 success', async () => {
    await newAccount(accounts, 'A1');
    await newAccount(accounts, 'A2');
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, async (_, index) => newAccount(accounts, `Corrida ${index}`)),
    );
    const failed = results.filter((result) => result.status === 'rejected');
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(failed).toHaveLength(9);
    for (const result of failed) expect(result.reason).toBeInstanceOf(PlanLimitError);
    expect(await count('accounts')).toBe(3);
  });

  it('10 parallel portfolio creations with 1 portfolio give exactly 1 success', async () => {
    await newPortfolio(portfolios, 'P1');
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, async (_, index) => newPortfolio(portfolios, `Corrida ${index}`)),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await count('portfolios')).toBe(2);
  });
});

describe('assertFeature', () => {
  it('refuses Pro features on Free (limit null) and allows them on Pro', async () => {
    const entitlements = createEntitlements({ identity: world.identity, billingEnabled: true });
    const ctx = await poolContext();
    expect(await refused(entitlements.assertFeature(ctx, 'real_estate'))).toMatchObject({
      resource: 'real_estate',
      limit: null,
    });
    await refused(entitlements.assertFeature(ctx, 'ai_import'));
    await subscribe('pro');
    await expect(entitlements.assertFeature(ctx, 'real_estate')).resolves.toBeUndefined();
    await expect(entitlements.assertFeature(ctx, 'ai_import')).resolves.toBeUndefined();
  });
});

describe('GET plan', () => {
  it('reports plan, limits, usage and features to any member', async () => {
    await newAccount(accounts, 'A1');
    for (const as of ['owner', 'admin', 'member', 'viewer'] as const) {
      const info = await plan.get(await s.as(as), s.poolA);
      expect(PoolPlanDto.parse(info)).toEqual(info);
      expect(info).toMatchObject({
        plan: 'free',
        billingEnabled: true,
        limits: { accounts: 3, portfolios: 2, members: 1 },
        usage: { accounts: 1, portfolios: 0, members: 4 },
        features: { real_estate: false, ai_import: false },
      });
    }
  });

  it('answers 404 to a non-member and 401 without a session', async () => {
    await expect(plan.get(await s.as('outsider'), s.poolA)).rejects.toBeInstanceOf(NotFoundError);
    await expect(plan.get(new Headers(), s.poolA)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
