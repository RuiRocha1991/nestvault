import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { newId } from '@nestvault/db';
import { logger, ROLE_PERMISSIONS } from '@nestvault/services';

import { createApiWorld, type ApiWorld, type Persona, type Scenario } from '../support/api-world';
import { APP_URL } from '../support/auth-harness';
import {
  keyOf,
  POOL_ROUTES,
  USER_ROUTES,
  type Negative,
  type PoolRoute,
  type UserRoute,
} from '../support/route-registry';
import { ErrorEnvelope, strictly } from '../support/strict-schema';

// The pool-isolation and authorization suite (NES-30, docs/testing.md). For every entry of the
// route registry it calls the real Route Handler with a real session, the real service and the real
// Postgres, and checks what every protected route must do: 401 without a session, 404 for a
// non-member (the same answer as for a pool that does not exist), 403 below the permission, 404 and
// no change for a resource of another pool, 400 for fields that must not come from the client, 403
// for a foreign Origin, and a success body that matches its output schema with nothing extra.
// The cases are generated: a new route only adds its registry entry.

const holder = vi.hoisted(() => ({ world: undefined as unknown as ApiWorld }));

vi.mock('@webapp/server/auth', () => ({
  getAuth: () => Promise.resolve(holder.world.auth),
  getRateLimiter: () => Promise.resolve(holder.world.limiter),
  getPoolsService: () => Promise.resolve(holder.world.pools),
  getInvitesService: () => Promise.resolve(holder.world.invites),
  getMembersService: () => Promise.resolve(holder.world.members),
  getAccountService: () => Promise.resolve(holder.world.account),
  getAuditService: () => Promise.resolve(holder.world.audit),
  getAccountsService: () => Promise.resolve(holder.world.accounts),
  getAssetsService: () => Promise.resolve(holder.world.assets),
  getCategoriesService: () => Promise.resolve(holder.world.categories),
  getTransactionsService: () => Promise.resolve(holder.world.transactions),
  getExpensesService: () => Promise.resolve(holder.world.expenses),
  getRulesService: () => Promise.resolve(holder.world.rules),
  getPortfoliosService: () => Promise.resolve(holder.world.portfolios),
  getOpsService: () => Promise.resolve(holder.world.ops),
  getCashMovesService: () => Promise.resolve(holder.world.cashMoves),
  getPlansService: () => Promise.resolve(holder.world.plans),
  getProductsService: () => Promise.resolve(holder.world.products),
  getDepositsService: () => Promise.resolve(holder.world.deposits),
  getInterestService: () => Promise.resolve(holder.world.interest),
  getNotesService: () => Promise.resolve(holder.world.notes),
  getMonthsService: () => Promise.resolve(holder.world.months),
  getHoldersService: () => Promise.resolve(holder.world.holders),
  getSettingsService: () => Promise.resolve(holder.world.settings),
  getPrototypeImportService: () => Promise.resolve(holder.world.prototypeImport),
}));
vi.mock('@nestvault/config', () => ({ env: { APP_URL: 'http://localhost:4000' } }));

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

beforeAll(async () => {
  logger.level = 'silent';
  holder.world = await createApiWorld();
});

afterAll(async () => {
  await holder.world.close();
});

const PRIVILEGE_ORDER = ['viewer', 'member', 'admin', 'owner'] as const;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface Call {
  as?: Persona | null;
  poolId?: string;
  params?: Record<string, string>;
  body?: unknown;
  query?: string;
  origin?: string | null;
}

type Spec = PoolRoute | UserRoute;

/** Calls the Route Handler the way Next.js does: a Request and the path parameters. */
async function invoke(spec: Spec, s: Scenario, call: Call = {}): Promise<Response> {
  const handler = (await spec.load())[spec.method];
  if (!handler) throw new Error(`${spec.method} ${spec.path} is not exported by its route file`);

  const params: Record<string, string> = {
    ...(spec.scope === 'pool' ? { poolId: call.poolId ?? s.poolA } : {}),
    ...(await spec.params?.(s)),
    ...call.params,
  };
  const path = spec.path.replace(/:(\w+)/g, (_, name: string) =>
    encodeURIComponent(params[name] ?? ''),
  );

  const headers = new Headers();
  const asPersona = call.as === undefined ? defaultCaller(spec) : call.as;
  if (asPersona !== null) {
    for (const [name, value] of (await s.as(asPersona)).entries()) headers.set(name, value);
  }
  const origin = call.origin === undefined ? APP_URL : call.origin;
  if (origin !== null) headers.set('origin', origin);
  if (call.body !== undefined) headers.set('content-type', 'application/json');

  const specQuery = typeof spec.query === 'function' ? await spec.query(s) : spec.query;
  const request = new Request(`${APP_URL}${path}${call.query ?? specQuery ?? ''}`, {
    method: spec.method,
    headers,
    ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
  });
  return handler(request, { params: Promise.resolve(params) });
}

/** The roles holding the permission, lowest first: if the registry names the wrong one, this breaks. */
const rolesWith = (permission: PoolRoute['permission']): Persona[] =>
  PRIVILEGE_ORDER.filter((role) => ROLE_PERMISSIONS[role].has(permission));

function defaultCaller(spec: Spec): Persona {
  if (spec.scope === 'user') return spec.caller;
  const [lowest] = rolesWith(spec.permission);
  if (!lowest) throw new Error(`No role holds ${spec.permission}`);
  return lowest;
}

async function errorOf(response: Response, status: number) {
  expect(response.status).toBe(status);
  const parsed = ErrorEnvelope.safeParse(await response.json());
  expect(parsed.success, 'the error body has the one public shape').toBe(true);
  return parsed.success ? parsed.data : undefined;
}

/** Everything of an error that must not depend on whether the pool exists (the request id differs). */
const publicPart = (error: Awaited<ReturnType<typeof errorOf>>) => error?.error;

const EXTRA_FIELDS = (s: Scenario): Record<string, unknown> => ({
  poolId: s.poolB,
  id: newId(),
  role: 'owner',
  createdBy: s.ids.outsider,
  userId: s.ids.outsider,
  ownerId: s.ids.outsider,
  email: 'attacker@example.test',
});

/**
 * Registers the cases of one route in order. The success case changes the shared scenario (it moves
 * ownership, removes a member, ends a session), so it must be the last one: registering anything
 * after it fails while the tests are collected, before any of them runs.
 */
function createCases() {
  let closed = false;
  const add = (name: string, run: () => Promise<void> | void) => {
    if (closed)
      throw new Error(`"${name}" is registered after the success case; keep that one last`);
    it(name, run);
  };
  return {
    add,
    addLast(name: string, run: () => Promise<void> | void) {
      add(name, run);
      closed = true;
    },
  };
}
type Cases = ReturnType<typeof createCases>;

/** Cases both scopes share. Success comes last because it changes the scenario. */
function sharedCases(spec: Spec, scenario: () => Scenario, cases: Cases) {
  const caller = defaultCaller(spec);
  const writes = WRITE_METHODS.has(spec.method);

  cases.add('answers 401 without a session', async () => {
    await errorOf(await invoke(spec, scenario(), { as: null }), 401);
  });

  if (writes) {
    cases.add('answers 403 for a foreign Origin and for a missing one (CSRF)', async () => {
      const s = scenario();
      const valid = await spec.body?.(s);
      await errorOf(await invoke(spec, s, { body: valid, origin: 'https://evil.example' }), 403);
      await errorOf(await invoke(spec, s, { body: valid, origin: null }), 403);
    });
  }

  const { body: makeBody, foreign, leaks } = spec;

  if (makeBody) {
    cases.add('answers 400 for fields the client must not send (mass assignment)', async () => {
      const s = scenario();
      const valid = makeBody(s) as Record<string, unknown>;
      const before = await s.stateDigest();
      let tried = 0;
      for (const [field, value] of Object.entries(EXTRA_FIELDS(s))) {
        if (field in valid) continue; // the route legitimately takes this field
        tried += 1;
        const error = await errorOf(
          await invoke(spec, s, { body: { ...valid, [field]: value } }),
          400,
        );
        expect(error?.error.code, `extra field ${field}`).toBe('validation_error');
        // The services answer without an issue list, and zod names an unknown key at the object's
        // own path (''), so the field is the cause because it is the only change to a body that
        // the success case sends. Where an issue is listed it must point at the object or the field.
        for (const issue of error?.error.issues ?? []) {
          expect(['', field], `issue path for ${field}`).toContain(issue.path);
        }
        expect(await s.stateDigest(), `${field} must not change anything`).toBe(before);
      }
      expect(tried).toBeGreaterThan(0);
    });
  }

  if (foreign) {
    cases.add(
      'answers 404 for a resource of another pool or user and leaves it unchanged',
      async () => {
        const s = scenario();
        const other = await foreign(s);
        const body = other.body ?? (await makeBody?.(s));
        await errorOf(await invoke(spec, s, { params: other.params ?? {}, body }), 404);
        await other.unchanged();
      },
    );
  } else {
    cases.add('declares why no foreign resource can be addressed', () => {
      expect(spec.noForeignBecause?.length ?? 0).toBeGreaterThan(20);
    });
  }

  if (leaks) {
    cases.add('returns nothing that belongs to another pool or user', async () => {
      const s = scenario();
      const needles = await leaks(s);
      expect(needles.length).toBeGreaterThan(0);
      const response = await invoke(spec, s);
      expect(response.status).toBe(spec.success.status);
      const text = await response.text();
      for (const needle of needles) {
        expect(needle.length).toBeGreaterThan(5);
        expect(text).not.toContain(needle);
      }
    });
  }

  for (const negative of spec.negatives ?? []) {
    cases.add(`${negative.name} (${negative.expect})`, async () => {
      const s = scenario();
      await errorOf(await invoke(spec, s, await negativeCall(spec, s, negative)), negative.expect);
    });
  }

  cases.addLast(`works for ${caller} and the body matches its output schema exactly`, async () => {
    const s = scenario();
    await spec.prepare?.(s);
    const response = await invoke(spec, s, { body: await spec.body?.(s) });
    expect(response.status).toBe(spec.success.status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    let body: unknown = undefined;
    if (spec.success.status === 204) expect(text).toBe('');
    else body = JSON.parse(text);
    if (spec.success.schema) strictly(spec.success.schema).parse(body);
    await spec.success.check?.(s, body);
  });
}

async function negativeCall(spec: Spec, s: Scenario, negative: Negative): Promise<Call> {
  return {
    as: negative.as ?? defaultCaller(spec),
    body: negative.body ?? (await spec.body?.(s)),
    ...(negative.query === undefined ? {} : { query: negative.query }),
  };
}

/** One describe per route: a fresh scenario, `extra` (cases of its scope), then the shared cases. */
function describeRoutes<T extends Spec>(
  specs: readonly T[],
  extra?: (spec: T, s: () => Scenario, cases: Cases) => void,
) {
  describe.each(specs.map((spec) => [keyOf(spec), spec] as const))('%s', (_name, spec) => {
    let current: Scenario | undefined;
    const scenario = () => {
      if (!current) throw new Error('The scenario is not ready');
      return current;
    };
    beforeAll(async () => {
      current = await holder.world.newScenario();
    });

    const cases = createCases();
    extra?.(spec, scenario, cases);
    sharedCases(spec, scenario, cases);
  });
}

describeRoutes(POOL_ROUTES, (spec, scenario, cases) => {
  cases.add(
    'answers 404 to a non-member exactly as to a pool that does not exist or is not a uuid',
    async () => {
      const s = scenario();
      const body = await spec.body?.(s);
      const caller = defaultCaller(spec);
      const answers = [
        await invoke(spec, s, { as: 'outsider', body }), // a real user, a real pool, not a member
        await invoke(spec, s, { as: caller, body, poolId: newId() }), // no such pool
        await invoke(spec, s, { as: caller, body, poolId: 'not-a-uuid' }), // malformed id
        await invoke(spec, s, { as: caller, body, poolId: s.poolB }), // a real pool of somebody else
      ];
      const errors = [];
      for (const answer of answers) errors.push(publicPart(await errorOf(answer, 404)));
      for (const error of errors) expect(error).toEqual(errors[0]);
    },
  );

  const holders = rolesWith(spec.permission);
  for (const role of PRIVILEGE_ORDER.filter((r) => !holders.includes(r))) {
    cases.add(`answers 403 to a ${role}: ${spec.permission} is missing`, async () => {
      const s = scenario();
      await errorOf(await invoke(spec, s, { as: role, body: await spec.body?.(s) }), 403);
    });
  }
});

describeRoutes(USER_ROUTES);
