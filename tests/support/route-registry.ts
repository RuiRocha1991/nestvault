import { expect } from 'vitest';
import type { z } from 'zod';

import {
  AcceptInviteDto,
  HolderDto,
  HolderListDto,
  InviteDto,
  InviteListDto,
  MemberListDto,
  MemberRoleDto,
  MeDto,
  MeWithPoolsDto,
  PoolSummaryDto,
  FxDto,
  RevokedSessionsDto,
  SessionListDto,
  SettingsDto,
  TransferOwnershipDto,
  type Permission,
} from '@nestvault/services';

import type { Persona, Scenario } from './api-world';
import { PASSWORD } from './auth-harness';
import type { HttpMethod } from './route-files';

// The route registry of the isolation suite (docs/testing.md, NES-30). Every Route Handler under
// `app/api/v1` has one entry; `tests/web/route-registry.test.ts` fails when a handler is missing,
// and `tests/web/route-isolation.integration.test.ts` generates the authorization and isolation
// cases of every entry against the real services and Postgres.
//
// To add a route: copy the entry of a similar one, set `permission` to what the service checks with
// `can()`, give a valid `body`/`params`, the success `schema` (the DTO) and, when the URL names a
// resource, `foreign` (the same kind of resource in pool B). Nothing else is needed: the cases are
// generated.

export type RouteModule = Partial<
  Record<
    HttpMethod,
    (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
  >
>;

/** What a route handler file exports; cast once here because each file types its own params. */
const load = <T>(module: Promise<T>) => module as unknown as Promise<RouteModule>;

/** The same kind of resource, but living in pool B (or belonging to another user). */
export interface Foreign {
  params?: Record<string, string>;
  body?: unknown;
  /** Asserts that the resource was not touched by the rejected call. */
  unchanged: () => Promise<void>;
}

export interface Negative {
  name: string;
  as?: Persona;
  body?: unknown;
  query?: string;
  expect: number;
}

interface Base {
  method: HttpMethod;
  /** As on disk: `/api/v1/pools/:poolId/members`. */
  path: string;
  load: () => Promise<RouteModule>;
}

interface Exercised {
  /** Valid path parameters besides `poolId` (ids that belong to the scenario's pool A). */
  params?: (s: Scenario) => Promise<Record<string, string>>;
  /** A valid body. Its presence means the route reads a body, so extra fields must answer 400. */
  body?: (s: Scenario) => unknown;
  query?: string;
  /** Sets up what the success case needs beyond the scenario (runs right before it). */
  prepare?: (s: Scenario) => Promise<void>;
  success: {
    status: number;
    /** The DTO the body is parsed with, with every object closed. */
    schema?: z.ZodType;
    check?: (s: Scenario, body: unknown) => Promise<void>;
  };
  foreign?: (s: Scenario) => Promise<Foreign>;
  /** Required when there is no `foreign`: why no id of another pool can be sent. */
  noForeignBecause?: string;
  /** Strings from pool B (or other users) that must not appear anywhere in the response. */
  leaks?: (s: Scenario) => Promise<string[]>;
  negatives?: Negative[];
}

export interface PoolRoute extends Base, Exercised {
  scope: 'pool';
  /** What the service checks with `can()`. The lowest role holding it must succeed, lower ones get 403. */
  permission: Permission;
}

export interface UserRoute extends Base, Exercised {
  scope: 'user';
  /** The signed-in user the cases run as. */
  caller: Persona;
}

export interface ExemptRoute extends Base {
  scope: 'exempt';
  reason: string;
}

export type RouteSpec = PoolRoute | UserRoute | ExemptRoute;

export const keyOf = (spec: Pick<Base, 'method' | 'path'>) => `${spec.method} ${spec.path}`;

const POOL = '/api/v1/pools/:poolId';

/** The scenario's pending invite in pool A or B, made once. */
const pendingInvite = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`invite-${pool}`, () => s.invite(pool));
/** A second session of the owner, made once. */
const ownerExtraSession = (s: Scenario) => s.memo('extra-session', () => s.extraSession('owner'));

/** A member of pool B only, addressed through pool A's URL: must answer 404 and keep their role. */
const foreignMember = (s: Scenario): Promise<Foreign> =>
  Promise.resolve({
    params: { userId: s.ids.bMember },
    unchanged: async () => {
      expect(await s.roleOf(s.poolB, 'bMember')).toBe('member');
    },
  });

/** A holder in pool A (made by its owner) or pool B (made by `outsider`), made once per scenario. */
const holderIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`holder-${pool}`, async () =>
    s.world.holders.create(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      pool === 'A'
        ? { name: 'Ana Alfa', aliases: ['ana alfa'] }
        : { name: 'Bruno Beta', aliases: ['bruno beta'] },
    ),
  );

/** The holder of pool B, addressed through pool A's URL: must answer 404 and stay as it was. */
const foreignHolder = async (s: Scenario): Promise<Foreign> => {
  const other = await holderIn(s, 'B');
  return {
    params: { id: other.id },
    unchanged: async () => {
      const seen = await s.world.holders.list(await s.as('outsider'), s.poolB);
      expect(seen.holders.find((holder) => holder.id === other.id)).toEqual(other);
    },
  };
};

export const ROUTE_REGISTRY: readonly RouteSpec[] = [
  // ---------------------------------------------------------------- pool scope: members
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/members`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/members/route')),
    success: { status: 200, schema: MemberListDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s people',
    leaks: (s) =>
      Promise.resolve([s.ids.outsider, s.ids.bMember, s.emails.outsider, s.emails.bMember]),
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/members/:userId`,
    permission: 'members.manage',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/members/[userId]/route')),
    params: (s) => Promise.resolve({ userId: s.ids.member }),
    body: () => ({ role: 'viewer' }),
    success: {
      status: 200,
      schema: MemberRoleDto,
      check: async (s) => {
        expect(await s.roleOf(s.poolA, 'member')).toBe('viewer');
      },
    },
    foreign: foreignMember,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/members/:userId`,
    permission: 'members.manage',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/members/[userId]/route')),
    params: (s) => Promise.resolve({ userId: s.ids.viewer }),
    success: {
      status: 204,
      check: async (s) => {
        expect(await s.roleOf(s.poolA, 'viewer')).toBeUndefined();
      },
    },
    foreign: foreignMember,
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/leave`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/leave/route')),
    success: {
      status: 204,
      check: async (s) => {
        expect(await s.roleOf(s.poolA, 'viewer')).toBeUndefined();
      },
    },
    noForeignBecause: 'takes no id; leaving a pool you are not in is the non-member 404 case',
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/transfer`,
    permission: 'pool.transfer',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/transfer/route')),
    body: (s) => ({ userId: s.ids.member, password: PASSWORD }),
    success: {
      status: 200,
      schema: TransferOwnershipDto,
      check: async (s) => {
        expect(await s.roleOf(s.poolA, 'member')).toBe('owner');
        expect(await s.roleOf(s.poolA, 'owner')).toBe('admin');
      },
    },
    foreign: (s) =>
      Promise.resolve({
        body: { userId: s.ids.bMember, password: PASSWORD },
        unchanged: async () => {
          expect(await s.roleOf(s.poolB, 'bMember')).toBe('member');
          expect(await s.roleOf(s.poolA, 'owner')).toBe('owner');
        },
      }),
  },

  // ---------------------------------------------------------------- pool scope: holders
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/holders`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/holders/route')),
    success: { status: 200, schema: HolderListDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s people',
    leaks: async (s) => {
      await holderIn(s, 'A');
      const other = await holderIn(s, 'B');
      return [other.id, other.name, ...other.aliases];
    },
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/holders`,
    permission: 'accounts.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/holders/route')),
    body: () => ({ name: 'Carla', aliases: ['carla gama'] }),
    success: { status: 201, schema: HolderDto },
    noForeignBecause: 'creates a new row; linking to a user of another pool is a negative case',
    negatives: [
      {
        name: 'links a user who is not a member of the pool',
        body: { name: 'Carla', userId: '00000000-0000-7000-8000-000000000001' },
        expect: 400,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/holders/:id`,
    permission: 'accounts.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/holders/[id]/route')),
    params: async (s) => ({ id: (await holderIn(s, 'A')).id }),
    body: () => ({ name: 'Ana Omega' }),
    success: { status: 200, schema: HolderDto },
    foreign: foreignHolder,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/holders/:id`,
    permission: 'accounts.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/holders/[id]/route')),
    params: async (s) => ({ id: (await holderIn(s, 'A')).id }),
    success: { status: 204 },
    foreign: foreignHolder,
  },

  // ---------------------------------------------------------------- pool scope: settings
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/settings`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/settings/route')),
    success: { status: 200, schema: SettingsDto },
    noForeignBecause: 'reads the URL’s own pool; there is no id in the path',
    leaks: async (s) => {
      await s.world.settings.update(await s.as('outsider'), s.poolB, {
        fxOverrides: { USD: '0.8123' },
      });
      return ['0.8123'];
    },
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/settings`,
    permission: 'settings.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/settings/route')),
    body: () => ({ depositTax: '25', transferWindowDays: 5 }),
    success: { status: 200, schema: SettingsDto },
    noForeignBecause: 'one row per pool, chosen by the URL’s pool; no id in the path',
    negatives: [
      { name: 'a negative tax', body: { depositTax: '-1' }, expect: 400 },
      { name: 'a rate for EUR', body: { fxOverrides: { EUR: '1' } }, expect: 400 },
      { name: 'a window beyond 30 days', body: { transferWindowDays: 31 }, expect: 400 },
    ],
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/fx`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/fx/route')),
    success: { status: 200, schema: FxDto },
    noForeignBecause: 'reads the URL’s own pool; the leak probe covers pool B’s overrides',
    leaks: async (s) => {
      await s.world.settings.update(await s.as('outsider'), s.poolB, {
        fxOverrides: { USD: '0.7771' },
      });
      return ['0.7771'];
    },
  },

  // ---------------------------------------------------------------- pool scope: invites
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/invites`,
    permission: 'members.invite',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/invites/route')),
    success: { status: 200, schema: InviteListDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s invites',
    leaks: async (s) => {
      await pendingInvite(s, 'A');
      const other = await pendingInvite(s, 'B');
      return [other.id, other.email];
    },
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/invites`,
    permission: 'members.invite',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/invites/route')),
    body: () => ({ email: 'new-person@example.test', role: 'viewer' }),
    success: { status: 201, schema: InviteDto },
    noForeignBecause: 'creates in the URL’s own pool; no id of another pool is accepted',
    negatives: [
      {
        name: 'an admin cannot invite an owner',
        as: 'admin',
        body: { email: 'boss@example.test', role: 'owner' },
        expect: 403,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/invites/:id`,
    permission: 'members.invite',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/invites/[id]/route')),
    params: async (s) => ({ id: (await pendingInvite(s, 'A')).id }),
    success: {
      status: 204,
      check: async (s) => {
        expect(await s.inviteRow((await pendingInvite(s, 'A')).id)).toBeUndefined();
      },
    },
    foreign: async (s) => {
      const other = await pendingInvite(s, 'B');
      const before = await s.inviteRow(other.id);
      return {
        params: { id: other.id },
        unchanged: async () => {
          expect(await s.inviteRow(other.id)).toEqual(before);
        },
      };
    },
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/invites/:id/resend`,
    permission: 'members.invite',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/invites/[id]/resend/route')),
    params: async (s) => ({ id: (await pendingInvite(s, 'A')).id }),
    success: { status: 200, schema: InviteDto },
    foreign: async (s) => {
      const other = await pendingInvite(s, 'B');
      const before = await s.inviteRow(other.id);
      const mails = s.world.mail.sent.length;
      return {
        params: { id: other.id },
        unchanged: async () => {
          expect(await s.inviteRow(other.id)).toEqual(before);
          expect(s.world.mail.sent).toHaveLength(mails);
        },
      };
    },
  },

  // ---------------------------------------------------------------- user scope
  {
    scope: 'user',
    method: 'POST',
    path: '/api/v1/pools',
    caller: 'owner',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/route')),
    body: () => ({ name: 'Another household' }),
    success: {
      status: 201,
      schema: PoolSummaryDto,
      check: async (s, body) => {
        const { id } = body as { id: string };
        expect(await s.roleOf(id, 'owner')).toBe('owner');
      },
    },
    noForeignBecause: 'there is no id in the request; the owner is the session user, never a field',
  },
  {
    scope: 'user',
    method: 'GET',
    path: '/api/v1/me',
    caller: 'owner',
    load: () => load(import('../../apps/web/src/app/api/v1/me/route')),
    success: { status: 200, schema: MeWithPoolsDto },
    noForeignBecause: 'always the session user’s own profile; the leak probe covers other users',
    leaks: (s) => Promise.resolve([s.ids.admin, s.emails.admin, s.ids.outsider, s.emails.outsider]),
  },
  {
    scope: 'user',
    method: 'PATCH',
    path: '/api/v1/me',
    caller: 'owner',
    load: () => load(import('../../apps/web/src/app/api/v1/me/route')),
    body: () => ({ name: 'Rui Rocha' }),
    success: { status: 200, schema: MeDto },
    noForeignBecause:
      'always the session user’s own profile; `id` or `email` in the body answer 400',
  },
  {
    scope: 'user',
    method: 'GET',
    path: '/api/v1/me/sessions',
    caller: 'owner',
    load: () => load(import('../../apps/web/src/app/api/v1/me/sessions/route')),
    success: { status: 200, schema: SessionListDto },
    noForeignBecause: 'lists the session user’s own sessions; the leak probe covers other users',
    leaks: async (s) => [...(await s.sessionIds('admin')), ...(await s.sessionIds('outsider'))],
  },
  {
    scope: 'user',
    method: 'DELETE',
    path: '/api/v1/me/sessions',
    caller: 'owner',
    load: () => load(import('../../apps/web/src/app/api/v1/me/sessions/route')),
    query: '?others=true',
    prepare: async (s) => {
      await ownerExtraSession(s);
    },
    success: {
      status: 200,
      schema: RevokedSessionsDto,
      check: async (s, body) => {
        expect((body as { revoked: number }).revoked).toBeGreaterThanOrEqual(1);
        expect(await s.sessionIds('admin')).not.toHaveLength(0);
        expect(await s.sessionIds('outsider')).not.toHaveLength(0);
      },
    },
    noForeignBecause:
      'ends only the session user’s other sessions; nothing in the request names one',
    negatives: [{ name: 'a bare DELETE never means “end everything”', query: '', expect: 400 }],
  },
  {
    scope: 'user',
    method: 'DELETE',
    path: '/api/v1/me/sessions/:id',
    caller: 'owner',
    load: () => load(import('../../apps/web/src/app/api/v1/me/sessions/[id]/route')),
    params: async (s) => ({
      id: (await ownerExtraSession(s)).id,
    }),
    success: {
      status: 204,
      check: async (s) => {
        const { id } = await ownerExtraSession(s);
        expect(await s.sessionIds('owner')).not.toContain(id);
      },
    },
    foreign: async (s) => {
      const [theirs] = await s.sessionIds('admin');
      return {
        params: { id: theirs ?? '' },
        unchanged: async () => {
          expect(await s.sessionIds('admin')).toContain(theirs);
        },
      };
    },
  },
  {
    scope: 'user',
    method: 'POST',
    path: '/api/v1/invites/:token/accept',
    caller: 'newcomer',
    load: () => load(import('../../apps/web/src/app/api/v1/invites/[token]/accept/route')),
    params: async (s) => ({
      token: (await s.memo('invite-for-newcomer', () => s.invite('B', s.emails.newcomer))).token,
    }),
    success: {
      status: 200,
      schema: AcceptInviteDto,
      check: async (s) => {
        expect(await s.roleOf(s.poolB, 'newcomer')).toBe('viewer');
      },
    },
    foreign: async (s) => {
      const elsewhere = await s.invite('B');
      const before = await s.inviteRow(elsewhere.id);
      return {
        params: { token: elsewhere.token },
        unchanged: async () => {
          expect(await s.inviteRow(elsewhere.id)).toEqual(before);
          expect(await s.roleOf(s.poolB, 'newcomer')).toBeUndefined();
        },
      };
    },
  },

  // ---------------------------------------------------------------- exempt, with the reason
  {
    scope: 'exempt',
    method: 'GET',
    path: '/api/v1/auth/*',
    load: () => load(import('../../apps/web/src/app/api/v1/auth/[...all]/route')),
    reason:
      'Better Auth’s own handler (session lookup, verification links): no pool data; covered by tests/services/auth.integration.test.ts and the Origin check in route()',
  },
  {
    scope: 'exempt',
    method: 'POST',
    path: '/api/v1/auth/*',
    load: () => load(import('../../apps/web/src/app/api/v1/auth/[...all]/route')),
    reason:
      'Better Auth’s own handler (sign-up, sign-in, password reset): no pool data; covered by the auth integration tests, which also check the Origin rule and the rate limits',
  },
  {
    scope: 'exempt',
    method: 'GET',
    path: '/api/v1/health',
    load: () => load(import('../../apps/web/src/app/api/v1/health/route')),
    reason: 'public liveness probe: no session, no pool, no data; the body is built from HealthDto',
  },
];

export const POOL_ROUTES = ROUTE_REGISTRY.filter(
  (route): route is PoolRoute => route.scope === 'pool',
);
export const USER_ROUTES = ROUTE_REGISTRY.filter(
  (route): route is UserRoute => route.scope === 'user',
);
