import { expect } from 'vitest';
import type { z } from 'zod';

import {
  AcceptInviteDto,
  AccountDto,
  AccountListDto,
  CategoryDto,
  CategoryListDto,
  AssetDto,
  AssetListDto,
  BulkPricesDto,
  PriceDto,
  PriceHistoryDto,
  SubAccountDto,
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

/** An account in pool A (made by its owner) or pool B (made by `outsider`), made once per scenario. */
const accountIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`account-${pool}`, async () => {
    const poolId = pool === 'A' ? s.poolA : s.poolB;
    const headers = await s.as(pool === 'A' ? 'owner' : 'outsider');
    const [holder] = (await s.world.holders.list(headers, poolId)).holders;
    return s.world.accounts.create(headers, poolId, {
      type: 'brokerage',
      name: pool === 'A' ? 'Conta Alfa' : 'Conta Beta',
      currency: 'EUR',
      holderIds: [holder?.id ?? ''],
    });
  });

/** A sub-account of the brokerage account in pool A or B, made once per scenario. */
const subAccountIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`sub-account-${pool}`, async () => {
    const account = await accountIn(s, pool);
    return s.world.accounts.createSubAccount(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      account.id,
      { name: pool === 'A' ? 'Sub Alfa' : 'Sub Beta' },
    );
  });

/** The account of pool B, addressed through pool A's URL: must answer 404 and stay as it was. */
const foreignAccount = async (s: Scenario): Promise<Foreign> => {
  const other = await accountIn(s, 'B');
  return {
    params: { id: other.id },
    unchanged: async () => {
      const seen = await s.world.accounts.get(await s.as('outsider'), s.poolB, other.id);
      expect(seen).toEqual(other);
    },
  };
};

/** The sub-account of pool B under pool B's account, addressed through pool A's URL. */
const foreignSubAccount = async (s: Scenario): Promise<Foreign> => {
  const other = await subAccountIn(s, 'B');
  return {
    params: { id: other.accountId, subId: other.id },
    unchanged: async () => {
      const seen = await s.world.accounts.get(await s.as('outsider'), s.poolB, other.accountId);
      expect(seen.subAccounts).toContainEqual(other);
    },
  };
};

/** An asset in pool A (made by its owner) or pool B (made by `outsider`), made once per scenario. */
const assetIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`asset-${pool}`, async () =>
    s.world.assets.create(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      pool === 'A'
        ? { ticker: 'ALFAFUND', name: 'Alfa Fund', type: 'etf', currency: 'EUR' }
        : { ticker: 'BETACORP', name: 'Beta Corp', type: 'stock', currency: 'USD' },
    ),
  );

/** The asset of pool B, addressed through pool A's URL: must answer 404 and stay as it was. */
const foreignAsset = async (s: Scenario): Promise<Foreign> => {
  const other = await assetIn(s, 'B');
  return {
    params: { id: other.id, date: '2026-01-02' },
    unchanged: async () => {
      const seen = await s.world.assets.get(await s.as('outsider'), s.poolB, other.id);
      expect(seen).toEqual(other);
    },
  };
};

/** A category of pool A (made by its owner) or pool B (made by `outsider`), made once per scenario. */
const categoryIn = (s: Scenario, pool: 'A' | 'B') =>
  s.memo(`category-${pool}`, async () =>
    s.world.categories.create(
      await s.as(pool === 'A' ? 'owner' : 'outsider'),
      pool === 'A' ? s.poolA : s.poolB,
      { name: pool === 'A' ? 'Categoria Alfa' : 'Categoria Beta', kind: 'expense' },
    ),
  );

/** The category of pool B, addressed through pool A's URL: must answer 404 and stay as it was. */
const foreignCategory = async (s: Scenario): Promise<Foreign> => {
  const other = await categoryIn(s, 'B');
  return {
    params: { id: other.id },
    unchanged: async () => {
      const seen = (await s.world.categories.list(await s.as('outsider'), s.poolB)).categories;
      expect(seen.find((category) => category.id === other.id)).toEqual(other);
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

  // ---------------------------------------------------------------- pool scope: assets
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/assets`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/assets/route')),
    success: { status: 200, schema: AssetListDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s assets',
    leaks: async (s) => {
      await assetIn(s, 'A');
      const other = await assetIn(s, 'B');
      return [other.id, other.ticker, other.name];
    },
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/assets`,
    permission: 'portfolios.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/assets/route')),
    body: () => ({ ticker: 'nova', name: 'Nova', type: 'etf', currency: 'EUR', divMonths: [3, 9] }),
    success: { status: 201, schema: AssetDto },
    noForeignBecause: 'creates a new row; the ticker is checked inside the URL’s own pool',
    negatives: [
      {
        name: 'a ticker with a space',
        body: { ticker: 'A B', name: 'x', type: 'etf', currency: 'EUR' },
        expect: 400,
      },
      {
        name: 'an unknown type',
        body: { ticker: 'X', name: 'x', type: 'nft', currency: 'EUR' },
        expect: 400,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/assets/:id`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/assets/[id]/route')),
    params: async (s) => ({ id: (await assetIn(s, 'A')).id }),
    success: { status: 200, schema: AssetDto },
    foreign: foreignAsset,
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/assets/:id`,
    permission: 'portfolios.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/assets/[id]/route')),
    params: async (s) => ({ id: (await assetIn(s, 'A')).id }),
    body: () => ({ name: 'Alfa Omega', dps: '1.5' }),
    success: { status: 200, schema: AssetDto },
    foreign: foreignAsset,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/assets/:id`,
    permission: 'portfolios.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/assets/[id]/route')),
    params: async (s) => ({ id: (await assetIn(s, 'A')).id }),
    success: { status: 204 },
    foreign: foreignAsset,
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/assets/:id/prices`,
    permission: 'pool.read',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/assets/[id]/prices/route')),
    params: async (s) => ({ id: (await assetIn(s, 'A')).id }),
    success: { status: 200, schema: PriceHistoryDto },
    foreign: foreignAsset,
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/assets/:id/prices`,
    permission: 'prices.write',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/assets/[id]/prices/route')),
    params: async (s) => ({ id: (await assetIn(s, 'A')).id }),
    body: () => ({ date: '2026-01-02', price: '101.25' }),
    success: { status: 200, schema: PriceDto },
    foreign: foreignAsset,
    negatives: [{ name: 'a price of zero', body: { date: '2026-01-02', price: '0' }, expect: 400 }],
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/assets/:id/prices/:date`,
    permission: 'prices.write',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/assets/[id]/prices/[date]/route')),
    params: async (s) => ({ id: (await assetIn(s, 'A')).id, date: '2026-01-02' }),
    prepare: async (s) => {
      const asset = await assetIn(s, 'A');
      await s.world.assets.setPrice(await s.as('owner'), s.poolA, asset.id, {
        date: '2026-01-02',
        price: '10',
      });
    },
    success: { status: 204 },
    foreign: foreignAsset,
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/asset-prices`,
    permission: 'prices.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/asset-prices/route')),
    prepare: async (s) => {
      await assetIn(s, 'A');
    },
    body: () => ({ prices: [{ ticker: 'alfafund', date: '2026-01-02', price: '10.5' }] }),
    success: { status: 200, schema: BulkPricesDto },
    noForeignBecause:
      'tickers are looked up inside the URL’s own pool; pool B’s ticker is a negative case',
    negatives: [
      {
        name: 'a ticker that only exists in pool B',
        body: { prices: [{ ticker: 'BETACORP', date: '2026-01-02', price: '1' }] },
        expect: 400,
      },
    ],
  },

  // ---------------------------------------------------------------- pool scope: categories
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/categories`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/categories/route')),
    success: { status: 200, schema: CategoryListDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s categories',
    leaks: async (s) => {
      await categoryIn(s, 'A');
      const other = await categoryIn(s, 'B');
      await s.world.categories.updateSettings(await s.as('outsider'), s.poolB, other.id, {
        monthlyBudget: '777.77',
      });
      return [other.id, other.name ?? '', '777.77'];
    },
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/categories`,
    permission: 'categories.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/categories/route')),
    body: () => ({ name: 'Nova categoria', kind: 'income', color: '#112233' }),
    success: { status: 201, schema: CategoryDto },
    noForeignBecause: 'creates a new row in the URL’s own pool; the pool never comes from the body',
    negatives: [
      {
        name: 'a system key',
        body: { name: 'x', kind: 'expense', systemKey: 'groceries' },
        expect: 400,
      },
      { name: 'an unknown kind', body: { name: 'x', kind: 'gift' }, expect: 400 },
    ],
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/categories/:id`,
    permission: 'categories.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/categories/[id]/route')),
    params: async (s) => ({ id: (await categoryIn(s, 'A')).id }),
    body: () => ({ name: 'Categoria Omega' }),
    success: { status: 200, schema: CategoryDto },
    foreign: foreignCategory,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/categories/:id`,
    permission: 'categories.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/categories/[id]/route')),
    params: async (s) => ({ id: (await categoryIn(s, 'A')).id }),
    success: { status: 204 },
    foreign: foreignCategory,
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/categories/:id/settings`,
    permission: 'categories.write',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/categories/[id]/settings/route')),
    params: async (s) => ({ id: (await categoryIn(s, 'A')).id }),
    body: () => ({ monthlyBudget: '150', hidden: true, colorOverride: '#AABBCC' }),
    success: { status: 200, schema: CategoryDto },
    foreign: foreignCategory,
  },

  // ---------------------------------------------------------------- pool scope: accounts
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/accounts`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/accounts/route')),
    success: { status: 200, schema: AccountListDto },
    noForeignBecause: 'lists the URL’s own pool; the leak probe covers pool B’s accounts',
    leaks: async (s) => {
      await accountIn(s, 'A');
      const other = await accountIn(s, 'B');
      const sub = await subAccountIn(s, 'B');
      return [other.id, other.name, sub.id, sub.name];
    },
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/accounts`,
    permission: 'accounts.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/accounts/route')),
    body: async (s) => ({
      type: 'checking',
      name: 'Conta nova',
      currency: 'EUR',
      iban: 'PT50 0002 0123 1234 5678 9015 4',
      holderIds: [(await s.world.holders.list(await s.as('owner'), s.poolA)).holders[0]?.id],
    }),
    success: { status: 201, schema: AccountDto },
    noForeignBecause: 'creates a new row; a holder of another pool is a negative case',
    negatives: [
      {
        name: 'names a person of another pool',
        body: {
          type: 'checking',
          name: 'X',
          currency: 'EUR',
          holderIds: ['00000000-0000-7000-8000-000000000001'],
        },
        expect: 400,
      },
      {
        name: 'an IBAN with a wrong check digit',
        body: {
          type: 'checking',
          name: 'X',
          currency: 'EUR',
          iban: 'PT50000201231234567890155',
          holderIds: ['00000000-0000-7000-8000-000000000001'],
        },
        expect: 400,
      },
    ],
  },
  {
    scope: 'pool',
    method: 'GET',
    path: `${POOL}/accounts/:id`,
    permission: 'pool.read',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/accounts/[id]/route')),
    params: async (s) => ({ id: (await accountIn(s, 'A')).id }),
    success: { status: 200, schema: AccountDto },
    foreign: foreignAccount,
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/accounts/:id`,
    permission: 'accounts.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/accounts/[id]/route')),
    params: async (s) => ({ id: (await accountIn(s, 'A')).id }),
    body: () => ({ name: 'Conta Omega', openingDate: '2026-01-01', opening: '10.5' }),
    success: { status: 200, schema: AccountDto },
    foreign: foreignAccount,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/accounts/:id`,
    permission: 'accounts.write',
    load: () => load(import('../../apps/web/src/app/api/v1/pools/[poolId]/accounts/[id]/route')),
    params: async (s) => ({ id: (await accountIn(s, 'A')).id }),
    success: { status: 204 },
    foreign: foreignAccount,
  },
  {
    scope: 'pool',
    method: 'POST',
    path: `${POOL}/accounts/:id/sub-accounts`,
    permission: 'accounts.write',
    load: () =>
      load(import('../../apps/web/src/app/api/v1/pools/[poolId]/accounts/[id]/sub-accounts/route')),
    params: async (s) => ({ id: (await accountIn(s, 'A')).id }),
    body: () => ({ name: 'Sub nova' }),
    success: { status: 201, schema: SubAccountDto },
    foreign: foreignAccount,
  },
  {
    scope: 'pool',
    method: 'PATCH',
    path: `${POOL}/accounts/:id/sub-accounts/:subId`,
    permission: 'accounts.write',
    load: () =>
      load(
        import('../../apps/web/src/app/api/v1/pools/[poolId]/accounts/[id]/sub-accounts/[subId]/route'),
      ),
    params: async (s) => {
      const sub = await subAccountIn(s, 'A');
      return { id: sub.accountId, subId: sub.id };
    },
    body: () => ({ name: 'Sub Omega' }),
    success: { status: 200, schema: SubAccountDto },
    foreign: foreignSubAccount,
  },
  {
    scope: 'pool',
    method: 'DELETE',
    path: `${POOL}/accounts/:id/sub-accounts/:subId`,
    permission: 'accounts.write',
    load: () =>
      load(
        import('../../apps/web/src/app/api/v1/pools/[poolId]/accounts/[id]/sub-accounts/[subId]/route'),
      ),
    params: async (s) => {
      const sub = await subAccountIn(s, 'A');
      return { id: sub.accountId, subId: sub.id };
    },
    success: { status: 204 },
    foreign: foreignSubAccount,
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
