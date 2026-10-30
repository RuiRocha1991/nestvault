import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';

import { testEnv } from '@nestvault/config/node';
import { parseKeyRing } from '@nestvault/crypto';
import {
  createIdentityDatabase,
  newId,
  poolMembersRepo,
  poolsRepo,
  usersRepo,
} from '@nestvault/db';
import type { IdentityDatabase } from '@nestvault/db';
import {
  createAccountService,
  createAccountsService,
  createAssetsService,
  createCategoriesService,
  createAuditService,
  createAuth,
  createInvitesService,
  createInviteVerifier,
  createEncryptedFileStore,
  createHoldersService,
  createImportsService,
  createMembersService,
  createMemoryEmailSender,
  createPoolsService,
  createRateLimiter,
  createOpsService,
  createCashMovesService,
  createGoalsService,
  createPropertiesService,
  createPlansService,
  createProductsService,
  createDepositsService,
  createInterestService,
  createMonthsService,
  createNotesService,
  createOverviewService,
  createPortfoliosService,
  createPrototypeImportService,
  createRulesService,
  createTransactionsService,
  createExpensesService,
  createSettingsService,
  requireSession,
  UnauthorizedError,
  type AccountService,
  type MonthsService,
  type AccountsService,
  type AssetsService,
  type CategoriesService,
  type ExpensesService,
  type AuditService,
  type HoldersService,
  type ImportsService,
  type Auth,
  type InvitesService,
  type MembersService,
  type MemoryEmailSender,
  type PoolsService,
  type RateLimiter,
  type OpsService,
  type CashMovesService,
  type EntitlementsService,
  type GoalsService,
  type PropertiesService,
  type PlansService,
  type ProductsService,
  type DepositsService,
  type InterestService,
  type NotesService,
  type OverviewService,
  type PortfoliosService,
  type PrototypeImportService,
  type RulesService,
  type TransactionsService,
  type SettingsService,
  createEntitlements,
  createEntitlementsService,
} from '@nestvault/services';

import { allCategories, openTestDatabase, type TestDatabase } from '../db/harness';

import {
  APP_URL,
  cookieOf,
  createTestClock,
  PASSWORD,
  postAuth,
  registerUser,
  rows,
  SECRET,
  tokenIn,
} from './auth-harness';
import { createFakeParser, type FakeParser } from './imports';

// The real services on the real `_test` databases, built the way `createAuthRuntime` builds them
// (same wiring, a memory mailbox and a test clock). The isolation suite mounts it behind the Route
// Handlers, so a request goes through the route, the session, the guards, the service, the
// repository and Postgres, with nothing mocked in between.

/** Who is who in a scenario. `outsider` owns pool B and is not a member of pool A. */
export const PERSONAS = [
  'owner',
  'admin',
  'member',
  'viewer',
  'outsider',
  'bMember',
  'newcomer',
] as const;
export type Persona = (typeof PERSONAS)[number];

export interface InviteHandle {
  id: string;
  email: string;
  token: string;
}

export interface ApiWorld {
  identity: IdentityDatabase;
  database: TestDatabase;
  auth: Auth;
  limiter: RateLimiter;
  mail: MemoryEmailSender;
  pools: PoolsService;
  members: MembersService;
  invites: InvitesService;
  account: AccountService;
  audit: AuditService;
  accounts: AccountsService;
  transactions: TransactionsService;
  expenses: ExpensesService;
  rules: RulesService;
  portfolios: PortfoliosService;
  ops: OpsService;
  cashMoves: CashMovesService;
  plans: PlansService;
  goals: GoalsService;
  /** Real estate, with billing off (every pool is Pro). */
  properties: PropertiesService;
  /** The world's test clock: services built outside the world must use it to agree on expiry. */
  now: () => Date;
  /** Plan and limits, with billing off (every pool is Pro). */
  entitlements: EntitlementsService;
  products: ProductsService;
  deposits: DepositsService;
  interest: InterestService;
  notes: NotesService;
  overview: OverviewService;
  months: MonthsService;
  assets: AssetsService;
  categories: CategoriesService;
  holders: HoldersService;
  settings: SettingsService;
  prototypeImport: PrototypeImportService;
  imports: ImportsService;
  /** The stand-in for the parser service behind `imports`, and where its files are kept. */
  importsKit: { parser: FakeParser; storageDir: string };
  /** Fresh pools A and B with a member of every role; nothing from an earlier scenario leaks in. */
  newScenario(): Promise<Scenario>;
  close(): Promise<void>;
}

export interface Scenario {
  world: ApiWorld;
  poolA: string;
  poolB: string;
  ids: Record<Persona, string>;
  emails: Record<Persona, string>;
  /** Cookie headers of the persona, signed in again if an earlier call ended the session. */
  as(persona: Persona): Promise<Headers>;
  /** A second session of the persona (a new sign-in); the first one stays valid. */
  extraSession(persona: Persona): Promise<{ headers: Headers; id: string }>;
  /** Runs `make` once per scenario, so a route can prepare a resource and use it in every case. */
  memo<T>(key: string, make: () => Promise<T>): Promise<T>;
  /** A pending invite in pool A (made by its owner) or pool B (made by `outsider`). */
  invite(pool: 'A' | 'B', forEmail?: string): Promise<InviteHandle>;
  inviteRow(id: string): Promise<Record<string, unknown> | undefined>;
  roleOf(poolId: string, persona: Persona): Promise<string | undefined>;
  sessionIds(persona: Persona): Promise<string[]>;
  /**
   * Everything a rejected request must leave alone: pools, memberships, invites, users, the number of
   * audit entries and of emails sent. Sessions are left out, they renew on every authenticated call.
   */
  stateDigest(): Promise<string>;
}

interface Account {
  email: string;
  id: string;
  cookie: string;
}

export async function createApiWorld(): Promise<ApiWorld> {
  const database = openTestDatabase();
  const identity = createIdentityDatabase(testEnv().TEST_DATABASE_URL_IDENTITY, 6);
  const clock = createTestClock();
  const mail = createMemoryEmailSender();
  const limiter = createRateLimiter({ identity, secret: SECRET, now: clock.now });
  const auth = createAuth({
    identity,
    appUrl: APP_URL,
    secret: SECRET,
    email: mail,
    limiter,
    trustedProxyHops: 1,
    allowSignup: true,
    invites: createInviteVerifier(identity, clock.now),
    checkBreached: () => Promise.resolve(false),
  });
  const pools = createPoolsService({ auth, identity, trustedProxyHops: 1 });
  const storageDir = await mkdtemp(join(tmpdir(), 'nv-world-imports-'));
  const parser = createFakeParser();
  const world: ApiWorld = {
    identity,
    database,
    auth,
    limiter,
    mail,
    pools,
    members: createMembersService({ auth, identity, limiter, trustedProxyHops: 1 }),
    invites: createInvitesService({
      auth,
      identity,
      entitlements: createEntitlements({ identity, billingEnabled: false }),
      limiter,
      email: mail,
      appUrl: APP_URL,
      trustedProxyHops: 1,
      now: clock.now,
    }),
    account: createAccountService({ auth, identity, pools, trustedProxyHops: 1 }),
    audit: createAuditService({ auth, identity }),
    accounts: createAccountsService({
      auth,
      identity,
      entitlements: createEntitlements({ identity, billingEnabled: false }),
      run: database.withPool,
      trustedProxyHops: 1,
    }),
    assets: createAssetsService({
      auth,
      identity,
      run: database.withPool,
      trustedProxyHops: 1,
    }),
    categories: createCategoriesService({
      auth,
      identity,
      run: database.withPool,
      trustedProxyHops: 1,
    }),
    transactions: createTransactionsService({
      auth,
      identity,
      run: database.withPool,
      trustedProxyHops: 1,
    }),
    expenses: createExpensesService({
      auth,
      identity,
      run: database.withPool,
      trustedProxyHops: 1,
      now: clock.now,
    }),
    rules: createRulesService({
      auth,
      identity,
      run: database.withPool,
      trustedProxyHops: 1,
    }),
    portfolios: createPortfoliosService({
      auth,
      identity,
      entitlements: createEntitlements({ identity, billingEnabled: false }),
      run: database.withPool,
      trustedProxyHops: 1,
    }),
    ops: createOpsService({
      auth,
      identity,
      run: database.withPool,
      trustedProxyHops: 1,
    }),
    plans: createPlansService({
      auth,
      identity,
      run: database.withPool,
      trustedProxyHops: 1,
    }),
    now: clock.now,
    entitlements: createEntitlementsService({
      auth,
      identity,
      billingEnabled: false,
      run: database.withPool,
    }),
    properties: createPropertiesService({
      auth,
      identity,
      entitlements: createEntitlements({ identity, billingEnabled: false }),
      run: database.withPool,
      trustedProxyHops: 1,
    }),
    goals: createGoalsService({
      auth,
      identity,
      run: database.withPool,
      trustedProxyHops: 1,
    }),
    cashMoves: createCashMovesService({
      auth,
      identity,
      run: database.withPool,
      trustedProxyHops: 1,
    }),
    products: createProductsService({
      auth,
      identity,
      run: database.withPool,
      trustedProxyHops: 1,
    }),
    deposits: createDepositsService({
      auth,
      identity,
      run: database.withPool,
      trustedProxyHops: 1,
    }),
    interest: createInterestService({
      auth,
      identity,
      run: database.withPool,
      trustedProxyHops: 1,
    }),
    notes: createNotesService({
      auth,
      identity,
      run: database.withPool,
      trustedProxyHops: 1,
    }),
    overview: createOverviewService({ auth, identity, run: database.withPool }),
    months: createMonthsService({
      auth,
      identity,
      run: database.withPool,
      trustedProxyHops: 1,
      now: clock.now,
    }),
    holders: createHoldersService({
      auth,
      identity,
      run: database.withPool,
      trustedProxyHops: 1,
    }),
    settings: createSettingsService({
      auth,
      identity,
      run: database.withPool,
      trustedProxyHops: 1,
    }),
    prototypeImport: createPrototypeImportService({
      auth,
      identity,
      limiter,
      run: database.withPool,
      trustedProxyHops: 1,
    }),
    imports: createImportsService({
      auth,
      identity,
      limiter,
      parser,
      files: createEncryptedFileStore({
        dir: storageDir,
        ring: parseKeyRing(randomBytes(32).toString('base64')),
      }),
      run: database.withPool,
      trustedProxyHops: 1,
    }),
    importsKit: { parser, storageDir },
    async newScenario() {
      return buildScenario(world, accounts, clock);
    },
    async close() {
      await rm(storageDir, { recursive: true, force: true });
      await identity.close();
      await database.close();
    },
  };

  await database.truncateAll();
  const accounts = new Map<Persona, Account>(
    await Promise.all(
      PERSONAS.map(async (persona): Promise<[Persona, Account]> => {
        const email = `${persona.toLowerCase()}@example.test`;
        await registerUser(auth, identity, email, { name: persona });
        const id = (await usersRepo.findIdByEmail(identity.db, email)) ?? '';
        return [persona, { email, id, cookie: await signIn(auth, email) }];
      }),
    ),
  );
  return world;
}

async function signIn(auth: Auth, email: string): Promise<string> {
  const response = await postAuth(auth, '/sign-in/email', { email, password: PASSWORD });
  return cookieOf(response);
}

function accountOf(accounts: Map<Persona, Account>, persona: Persona): Account {
  const account = accounts.get(persona);
  if (!account) throw new Error(`No account for ${persona}`);
  return account;
}

async function buildScenario(
  world: ApiWorld,
  accounts: Map<Persona, Account>,
  clock: ReturnType<typeof createTestClock>,
): Promise<Scenario> {
  // The rate-limit windows (sign-in, invites, `api`) start empty for every scenario.
  clock.advance(3 * 60 * 60);
  const memos = new Map<string, Promise<unknown>>();
  let counter = 0;

  const headersOf = async (persona: Persona): Promise<Headers> => {
    const account = accountOf(accounts, persona);
    try {
      await requireSession(world.auth, new Headers({ cookie: account.cookie }));
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) throw error;
      account.cookie = await signIn(world.auth, account.email);
    }
    return new Headers({ cookie: account.cookie });
  };

  const ids = Object.fromEntries(PERSONAS.map((p) => [p, accountOf(accounts, p).id])) as Record<
    Persona,
    string
  >;
  const emails = Object.fromEntries(
    PERSONAS.map((p) => [p, accountOf(accounts, p).email]),
  ) as Record<Persona, string>;

  // Written through the repositories: the service caps how many pools one user owns, and a suite
  // that makes two pools per route would reach it. `POST /api/v1/pools` covers the real path.
  const makePool = async (name: string, owner: Persona): Promise<string> => {
    const poolId = newId();
    await world.identity.db.transaction(async (tx) => {
      await poolsRepo.insert(tx, { id: poolId, name });
      await poolMembersRepo.insert(tx, { poolId, userId: ids[owner], role: 'owner' });
    });
    return poolId;
  };
  // Earlier scenarios' pools would pile up on `owner` and reach the cap of owned pools (409 on
  // `POST /api/v1/pools`): the previous A and B are dropped first (members and invites cascade).
  await rows(world.identity, sql`delete from pools where name in ('Pool A', 'Pool B')`);
  const [poolA, poolB] = await Promise.all([
    makePool('Pool A', 'owner'),
    makePool('Pool B', 'outsider'),
  ]);
  await Promise.all([
    ...(['admin', 'member', 'viewer'] as const).map((role) =>
      poolMembersRepo.insert(world.identity.db, { poolId: poolA, userId: ids[role], role }),
    ),
    poolMembersRepo.insert(world.identity.db, {
      poolId: poolB,
      userId: ids.bMember,
      role: 'member',
    }),
  ]);

  const scenario: Scenario = {
    world,
    poolA,
    poolB,
    ids,
    emails,
    as: headersOf,
    async extraSession(persona) {
      const cookie = await signIn(world.auth, accountOf(accounts, persona).email);
      const headers = new Headers({ cookie });
      const current = (await world.account.listSessions(headers)).sessions.find((s) => s.current);
      if (!current) throw new Error('The new session is not listed');
      return { headers, id: current.id };
    },
    memo(key, make) {
      const existing = memos.get(key);
      if (existing) return existing as Promise<never>;
      const created = make();
      memos.set(key, created);
      return created;
    },
    async invite(pool, forEmail) {
      counter += 1;
      const email = forEmail ?? `invitee-${newId().slice(-12)}-${counter}@example.test`;
      const inviter = pool === 'A' ? 'owner' : 'outsider';
      const created = await world.invites.create(
        await headersOf(inviter),
        pool === 'A' ? poolA : poolB,
        {
          email,
          role: 'viewer',
        },
      );
      const message = world.mail.sent
        .filter((m) => m.to === email && m.subject.startsWith('Convite para'))
        .at(-1);
      return { id: created.id, email, token: tokenIn(message?.text ?? '', 'convite') };
    },
    async inviteRow(id) {
      const [row] = await rows(world.identity, sql`select * from invites where id = ${id}`);
      return row;
    },
    async roleOf(poolId, persona) {
      const [row] = await rows<{ role: string }>(
        world.identity,
        sql`select role from pool_members where pool_id = ${poolId} and user_id = ${ids[persona]}`,
      );
      return row?.role;
    },
    async stateDigest() {
      const tables = await Promise.all([
        rows(world.identity, sql`select * from pools order by id`),
        rows(world.identity, sql`select * from pool_members order by pool_id, user_id`),
        rows(world.identity, sql`select * from invites order by id`),
        rows(world.identity, sql`select id, name, email from "user" order by id`),
        rows(world.identity, sql`select count(*)::int as entries from audit_log`),
        // The app database is forced-RLS for `app_rw`: read it as the owner.
        world.database.asMigrator(
          async (pool) =>
            [
              (await pool.query('select * from holders order by id')).rows,
              (await pool.query('select * from pool_settings order by id')).rows,
              (await pool.query('select * from accounts order by id')).rows,
              (await pool.query('select * from account_holders order by account_id, holder_id'))
                .rows,
              (await pool.query('select * from sub_accounts order by id')).rows,
              (await pool.query('select * from transactions order by id')).rows,
              (await pool.query('select * from category_rules order by id')).rows,
              (await pool.query('select * from portfolios order by id')).rows,
              (await pool.query('select * from investment_ops order by id')).rows,
              (await pool.query('select * from plans order by id')).rows,
              (await pool.query('select * from goals order by id')).rows,
              (await pool.query('select * from goal_scopes order by id')).rows,
              (await pool.query('select * from properties order by id')).rows,
              (await pool.query('select * from property_holders order by property_id, holder_id'))
                .rows,
              (await pool.query('select * from property_valuations order by id')).rows,
              (await pool.query('select * from portfolio_cash_moves order by id')).rows,
              (await pool.query('select * from savings_products order by id')).rows,
              (await pool.query('select * from deposits order by id')).rows,
              (await pool.query('select * from interest_entries order by id')).rows,
              (await pool.query('select * from month_notes order by id')).rows,
              (await pool.query('select * from assets order by id')).rows,
              (await pool.query('select * from asset_prices order by asset_id, date')).rows,
              await allCategories(pool),
              (
                await pool.query(
                  'select * from pool_category_settings order by pool_id, category_id',
                )
              ).rows,
            ] as unknown[],
        ),
      ]);
      return JSON.stringify([...tables, world.mail.sent.length]);
    },
    async sessionIds(persona) {
      const found = await rows<{ id: string }>(
        world.identity,
        sql`select id from session where user_id = ${ids[persona]} order by id`,
      );
      return found.map((row) => row.id);
    },
  };
  return scenario;
}
