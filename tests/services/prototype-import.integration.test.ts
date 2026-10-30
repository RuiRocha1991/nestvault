import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { interestEntriesRepo } from '@nestvault/db';
import { accountBalances, monthFlows, toPlain } from '@nestvault/domain';
import {
  ConflictError,
  createPrototypeImportService,
  ForbiddenError,
  ImportResultDto,
  logger,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from '@nestvault/services';

import { createApiWorld, type ApiWorld, type Persona, type Scenario } from '../support/api-world';
import { rows } from '../support/auth-harness';
import { fixtureLedger, fixturePositionsValue, importedLedger } from '../support/prototype-figures';
import { FIXTURE_COUNTS, FIXTURE_WARNINGS, readFixtureJson } from '../support/prototype-fixture';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

let world: ApiWorld;
let s: Scenario;

beforeAll(async () => {
  logger.level = 'silent';
  world = await createApiWorld();
});

beforeEach(async () => {
  s = await world.newScenario();
});

afterAll(async () => {
  await world.close();
});

const body = (dryRun: boolean, patch: Record<string, unknown> = {}) => ({
  dryRun,
  export: { ...readFixtureJson(), ...patch },
});
const run = async (as: Persona, input: unknown, poolId = s.poolA) =>
  world.prototypeImport.run(await s.as(as), poolId, input);
const warningsOf = (result: ImportResultDto) =>
  Object.fromEntries(result.warnings.map((warning) => [warning.code, warning.count]));

/**
 * Reads the app database as its owner, scoped to one pool: the tables force row-level security even
 * on their owner, so a plain read would see nothing.
 */
async function inPool<T>(
  poolId: string,
  work: (
    query: <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>,
  ) => Promise<T>,
): Promise<T> {
  return world.database.asMigrator(async (pool) => {
    await pool.query('begin');
    try {
      await pool.query("select set_config('app.pool_id', $1, true)", [poolId]);
      return await work(async <R>(text: string, params?: unknown[]) => {
        const result = await pool.query(text, params);
        return result.rows as R[];
      });
    } finally {
      await pool.query('commit');
    }
  });
}

/** Rows per table of the pool. */
async function tableCounts(poolId: string): Promise<Record<string, number>> {
  const tables = [
    'accounts',
    'account_holders',
    'sub_accounts',
    'transactions',
    'category_rules',
    'portfolios',
    'investment_ops',
    'plans',
    'goals',
    'goal_scopes',
    'portfolio_cash_moves',
    'savings_products',
    'deposits',
    'interest_entries',
    'assets',
    'asset_prices',
    'pool_category_settings',
    'month_notes',
  ];
  return inPool(poolId, async (query) => {
    const counts: Record<string, number> = {};
    for (const table of tables) {
      counts[table] =
        (await query<{ n: number }>(`select count(*)::int as n from ${table}`))[0]?.n ?? -1;
    }
    counts.categories =
      (
        await query<{ n: number }>('select count(*)::int as n from categories where pool_id = $1', [
          poolId,
        ])
      )[0]?.n ?? -1;
    return counts;
  });
}
const everythingEmpty = (counts: Record<string, number>) =>
  Object.values(counts).every((count) => count === 0);

async function auditEntries(action = 'pool.prototype_imported') {
  return rows<{ pool_id: string; meta: Record<string, unknown>; target: string }>(
    world.identity,
    sql`select pool_id, meta, target from audit_log where action = ${action} and pool_id in (${s.poolA}, ${s.poolB})`,
  );
}

describe('prototype import: dry run', () => {
  it('returns the counts and warnings of the fixture and writes nothing', async () => {
    const before = await s.stateDigest();
    const result = await run('owner', body(true));
    expect(ImportResultDto.parse(result)).toEqual(result);
    expect(result.dryRun).toBe(true);
    expect(result.counts).toEqual(FIXTURE_COUNTS);
    expect(warningsOf(result)).toEqual(FIXTURE_WARNINGS);
    // The owner's own holder is created by the sync that every holder screen does; nothing else is.
    expect(everythingEmpty(await tableCounts(s.poolA))).toBe(true);
    expect(await auditEntries()).toEqual([]);
    const afterDigest = await s.stateDigest();
    expect((JSON.parse(afterDigest) as unknown[]).slice(0, 3)).toEqual(
      (JSON.parse(before) as unknown[]).slice(0, 3),
    );
  });

  it('can be repeated, and a commit afterwards gives the same counts', async () => {
    const first = await run('owner', body(true));
    const second = await run('owner', body(true));
    expect(second).toEqual(first);
    const committed = await run('owner', body(false));
    expect(committed.counts).toEqual(first.counts);
    expect(committed.dryRun).toBe(false);
  });
});

describe('prototype import: commit', () => {
  it('writes the whole fixture, with new UUID v7 ids and SHA-256 hashes', async () => {
    const result = await run('owner', body(false));
    expect(result.counts).toEqual(FIXTURE_COUNTS);
    expect(await tableCounts(s.poolA)).toEqual({
      accounts: 6,
      account_holders: 7,
      sub_accounts: 2,
      transactions: 24,
      category_rules: 5,
      portfolios: 2,
      investment_ops: 9,
      plans: 1,
      goals: 2,
      goal_scopes: 3,
      portfolio_cash_moves: 2,
      savings_products: 1,
      deposits: 1,
      interest_entries: 2,
      assets: 4,
      asset_prices: 6,
      pool_category_settings: 4,
      month_notes: 0,
      categories: 2,
    });
    const stored = await inPool(s.poolA, async (query) => ({
      tx: await query(
        'select id, hash, is_transfer, pair_id, kind_lock, manual_category, dep_link, note from transactions order by date, id',
      ),
      accounts: await query('select id from accounts'),
    }));
    const v7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (const row of [...stored.tx, ...stored.accounts]) expect(row.id).toMatch(v7);
    for (const row of stored.tx) {
      expect(row.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.note).toBeNull();
    }
    // Pairs: two pairs, each side pointing at the other; manual categories and locks survive.
    const paired = stored.tx.filter((row) => row.pair_id !== null);
    expect(paired).toHaveLength(4);
    for (const row of paired) {
      expect(stored.tx.find((other) => other.id === row.pair_id)?.pair_id).toBe(row.id);
      expect(row.is_transfer).toBe(true);
    }
    expect(stored.tx.filter((row) => row.manual_category)).toHaveLength(3);
    expect(stored.tx.filter((row) => row.kind_lock)).toHaveLength(3);
    expect(stored.tx.filter((row) => row.dep_link)).toHaveLength(1);
  });

  it('imports the goals with what they count, calculated like the prototype’s', async () => {
    await run('owner', body(false));
    const { goals } = await world.goals.list(await s.as('owner'), s.poolA);
    expect(goals.map((goal) => [goal.name, goal.type, goal.mode])).toEqual([
      ['Independência financeira', 'value', 'date'],
      ['Investir 6000 € este ano', 'contrib', 'date'],
    ]);
    const [value, contrib] = goals;
    expect(value).toMatchObject({ target: '300000.0000', monthly: '450.0000', yield: null });
    expect(value?.portfolioIds).toHaveLength(1);
    // The second goal counts one account and one sub-account of it.
    expect(contrib?.accounts).toHaveLength(2);
    expect(contrib?.accounts.filter((scope) => scope.subAccountId)).toHaveLength(1);
    expect(contrib?.deadline).toBe('2026-12-31');
  });

  it('records one audit entry with the number of rows and nothing else', async () => {
    await run('owner', body(false));
    const entries = await auditEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ pool_id: s.poolA, target: s.poolA });
    expect(Object.keys(entries[0]?.meta ?? {})).toEqual(['count']);
    expect(entries[0]?.meta.count).toBeGreaterThan(50);
  });

  it('puts the overview figures back: balances, month flows and the value of the positions', async () => {
    const raw = readFixtureJson();
    await run('owner', body(false));
    const headers = await s.as('owner');
    const today = new Date().toISOString().slice(0, 10);

    const before = fixtureLedger(raw);
    const after = await importedLedger(world, headers, s.poolA);

    // Month income, expenses (net of refunds, without transfers and investments) and transfers.
    const months = ['2026-01', '2026-02', '2026-03'];
    const flowsBefore = monthFlows(before, months).map((flow) => [
      flow.month,
      toPlain(flow.income),
      toPlain(flow.expenses),
      toPlain(flow.transfers),
    ]);
    const flowsAfter = monthFlows(after, months).map((flow) => [
      flow.month,
      toPlain(flow.income),
      toPlain(flow.expenses),
      toPlain(flow.transfers),
    ]);
    expect(flowsAfter).toEqual(flowsBefore);
    // A sanity value worked out by hand: January's expense lines (transfers and income left out).
    expect(flowsAfter[0]?.[2]).toBe('867.37');

    // The balance of every account, the term deposit included.
    const expectedBalances = accountBalances(before, today);
    const names = new Map(
      (raw.accounts as { id: string; name: string }[]).map((account) => [account.id, account.name]),
    );
    const listed = (await world.accounts.list(headers, s.poolA)).accounts;
    for (const [id, balance] of expectedBalances) {
      const imported = listed.find((account) => account.name === names.get(id));
      expect(imported && toPlain(imported.balance)).toBe(toPlain(balance));
    }
    expect(listed.find((account) => account.name === 'Conta Ana')?.balance).toBe('1436.74');

    // Investments: units × current price × the prototype's USD rate.
    const summary = await world.portfolios.summary(headers, s.poolA, { asOf: today });
    expect(fixturePositionsValue(raw)).toBe('2114');
    expect(toPlain(summary.value)).toBe('2114');

    // The settings the figures depend on came across.
    expect(await world.settings.get(headers, s.poolA)).toEqual({
      transferWindowDays: 3,
      depositTax: '28',
      dividendTax: '28',
      displayCurrency: 'EUR',
      fxOverrides: { USD: '0.92', GBP: '1.17', CHF: '1.06' },
    });
  });

  it('maps categories to the global catalogue and keeps budgets, colours and rules', async () => {
    await run('owner', body(false));
    const headers = await s.as('owner');
    const categories = (await world.categories.list(headers, s.poolA)).categories;
    const byKey = (key: string) => categories.find((category) => category.systemKey === key);
    expect(byKey('groceries')).toMatchObject({ monthlyBudget: '450', global: true });
    expect(byKey('housing')).toMatchObject({ monthlyBudget: '700', colorOverride: '#112233' });
    expect(byKey('fuel')?.monthlyBudget).toBeNull();
    const own = categories.filter((category) => !category.global);
    expect(own.map((category) => [category.name, category.kind, category.monthlyBudget])).toEqual([
      ['Cantina', 'expense', '40'],
      ['Mesada', 'income', null],
    ]);
    const rules = (await world.rules.list(headers, s.poolA)).rules;
    expect(rules.map((rule) => rule.keyword)).toEqual([
      'GALP',
      'CONTINENTE',
      'BP',
      'EDP',
      'CANTINA',
    ]);
    expect(rules.map((rule) => rule.position)).toEqual([1, 2, 3, 4, 5]);
    expect(rules[4]?.accountId).toBe(
      (await world.accounts.list(headers, s.poolA)).accounts.find((a) => a.name === 'Conta Ana')
        ?.id,
    );
  });

  it('creates the people of the file, links the accounts to them and aliases are normalized', async () => {
    await run('owner', body(false));
    const headers = await s.as('owner');
    const holders = (await world.holders.list(headers, s.poolA)).holders;
    expect(holders.map((holder) => holder.name).sort()).toEqual([
      'Ana',
      'Filho',
      'Rui',
      'admin',
      'member',
      'owner',
      'viewer',
    ]);
    const ana = holders.find((holder) => holder.name === 'Ana');
    expect(ana).toMatchObject({ userId: null, aliases: ['ANA SILVA', 'A SILVA'] });
    const accounts = (await world.accounts.list(headers, s.poolA)).accounts;
    expect(accounts.find((account) => account.name === 'Poupança Casa')?.holderIds).toHaveLength(2);
    expect(accounts.find((account) => account.name === 'Corretora X')).toMatchObject({
      type: 'brokerage',
      xtbAccountNo: '12345678',
    });
  });

  it('reuses a person the pool already has instead of duplicating them', async () => {
    const named = {
      members: [
        { id: 'm1', name: 'OWNER', color: '#F2913D', aliases: '' },
        { id: 'm2', name: 'Rui', color: '#6C5CFF' },
        { id: 'm3', name: 'Filho', color: '#2BC6B4' },
      ],
    };
    const result = await run('owner', body(false, named));
    expect(result.counts).toMatchObject({ holders: 2, holdersMatched: 1 });
    const headers = await s.as('owner');
    const holders = (await world.holders.list(headers, s.poolA)).holders;
    expect(holders).toHaveLength(6);
    const mine = holders.find((holder) => holder.userId === s.ids.owner);
    const accounts = (await world.accounts.list(headers, s.poolA)).accounts;
    expect(accounts.find((account) => account.name === 'Conta Ana')?.holderIds).toEqual([mine?.id]);
  });

  it('stores text with SQL and HTML in it literally and leaves the tables alone', async () => {
    const payload = "Robert'); DROP TABLE holders; --";
    await run(
      'owner',
      body(false, {
        members: [
          { id: 'm1', name: payload, color: '#F2913D', aliases: "'; DELETE FROM accounts; --" },
          { id: 'm2', name: 'Rui' },
          { id: 'm3', name: 'Filho' },
        ],
        categories: [
          {
            id: 'cx1',
            name: "<img src=x onerror=alert(1)>'; --",
            kind: 'expense',
            color: '#AA33BB',
          },
        ],
        rules: [],
      }),
    );
    const headers = await s.as('owner');
    const holders = (await world.holders.list(headers, s.poolA)).holders;
    expect(holders.map((holder) => holder.name)).toContain(payload);
    const page = await world.transactions.list(headers, s.poolA, { q: 'DROP TABLE' });
    expect(page.transactions.map((tx) => tx.description)).toEqual([
      "'); DROP TABLE accounts; -- <script>alert(1)</script>",
    ]);
    const categories = (await world.categories.list(headers, s.poolA)).categories;
    expect(categories.map((category) => category.name)).toContain(
      "<img src=x onerror=alert(1)>'; --",
    );
    expect((await tableCounts(s.poolA)).accounts).toBe(6);
  });

  it('leaves month notes as they were and imports no note of its own', async () => {
    const owner = await s.as('owner');
    const note = await world.notes.putMonthNote(owner, s.poolA, '2026-01', {
      body: 'Janeiro: férias e IRS',
      expectedUpdatedAt: null,
    });
    await run('owner', body(false));
    expect(await world.notes.getMonthNote(owner, s.poolA, '2026-01')).toEqual(note);
    expect((await tableCounts(s.poolA)).month_notes).toBe(1);
    const notes = await inPool(s.poolA, (query) =>
      query('select count(*)::int as n from transactions where note is not null'),
    );
    expect(notes).toEqual([{ n: 0 }]);
  });

  it('accepts an empty export (a prototype never used) and creates nothing', async () => {
    const result = await run('owner', { dryRun: false, export: { v: 6 } });
    expect(Object.values(result.counts)).toEqual(Array.from({ length: 19 }, () => 0));
    expect(result.warnings).toEqual([]);
  });
});

describe('prototype import: refusals leave nothing behind', () => {
  it('answers 409 when the pool already has data, for a dry run and a commit', async () => {
    await run('owner', body(false));
    const digest = await s.stateDigest();
    await expect(run('owner', body(false))).rejects.toBeInstanceOf(ConflictError);
    await expect(run('owner', body(true))).rejects.toBeInstanceOf(ConflictError);
    expect(await s.stateDigest()).toBe(digest);
  });

  it('counts an account made by hand as data', async () => {
    const owner = await s.as('owner');
    const [holder] = (await world.holders.list(owner, s.poolA)).holders;
    await world.accounts.create(owner, s.poolA, {
      type: 'checking',
      name: 'À mão',
      currency: 'EUR',
      holderIds: [holder?.id ?? ''],
    });
    const digest = await s.stateDigest();
    await expect(run('owner', body(false))).rejects.toBeInstanceOf(ConflictError);
    expect(await s.stateDigest()).toBe(digest);
  });

  it('lets only one of two simultaneous commits win', async () => {
    const outcomes = await Promise.allSettled([
      run('owner', body(false)),
      run('owner', body(false)),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const lost = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(lost?.status === 'rejected' && lost.reason).toBeInstanceOf(ConflictError);
    expect((await tableCounts(s.poolA)).transactions).toBe(24);
  });

  it.each([
    [
      'an unknown field in the export',
      { ...body(false), export: { ...readFixtureJson(), extra: 1 } },
    ],
    ['an unknown field in an account', body(false, { accounts: [{ id: 'a', pool_id: 'x' }] })],
    ['an unknown field in the request', { ...body(false), poolId: 'x' }],
    ['no dryRun', { export: readFixtureJson() }],
    ['a dryRun that is not a boolean', { dryRun: 'false', export: readFixtureJson() }],
    ['an export that is a list', { dryRun: false, export: [] }],
    ['a body that is a string', 'not an object'],
    ['example data', body(false, { demo: true })],
    ['a version from the future', body(false, { v: 99 })],
    [
      'a value the schema cannot store',
      body(false, { portfolios: [{ id: 'p', name: 'x', ccy: 'XYZ' }] }),
    ],
  ])('answers 400 for %s and writes nothing', async (_name, input) => {
    const digest = await s.stateDigest();
    const error = await run('owner', input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect(await s.stateDigest()).toBe(digest);
    expect(everythingEmpty(await tableCounts(s.poolA))).toBe(true);
  });

  it('names the field that is wrong', async () => {
    const error = await run('owner', body(false, { tx: [{ id: 't1', bogus: true }] })).catch(
      (caught: unknown) => caught,
    );
    expect((error as ValidationError).issues.map((issue) => issue.path)).toContain('export.tx.0');
  });

  it('refuses a file nested far too deeply, before parsing it further', async () => {
    let deep: unknown = 1;
    for (let i = 0; i < 40; i += 1) deep = { a: deep };
    await expect(run('owner', { dryRun: true, export: deep })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rolls everything back when a late write fails', async () => {
    const digest = await s.stateDigest();
    const failure = Object.assign(new Error('insert failed'), {
      cause: { code: '23514', constraint: 'interest_entries_note_len' },
    });
    const spy = vi.spyOn(interestEntriesRepo, 'insert').mockRejectedValueOnce(failure);
    try {
      await expect(run('owner', body(false))).rejects.toBeInstanceOf(ValidationError);
    } finally {
      spy.mockRestore();
    }
    // By then accounts, movements, operations… had been written inside the transaction.
    expect(everythingEmpty(await tableCounts(s.poolA))).toBe(true);
    expect(await s.stateDigest()).toBe(digest);
    expect(await auditEntries()).toEqual([]);
    // And the same file imports afterwards: the lock and the pool were released.
    expect((await run('owner', body(false))).counts).toEqual(FIXTURE_COUNTS);
  });

  it('rolls back on an unexpected error too, and does not hide it as a 400', async () => {
    const spy = vi
      .spyOn(interestEntriesRepo, 'insert')
      .mockRejectedValueOnce(new Error('disk gone'));
    try {
      await expect(run('owner', body(false))).rejects.toThrow('disk gone');
    } finally {
      spy.mockRestore();
    }
    expect(everythingEmpty(await tableCounts(s.poolA))).toBe(true);
  });
});

describe('prototype import: who may run it', () => {
  it.each(['admin', 'member', 'viewer'] as const)('refuses %s with 403', async (persona) => {
    const digest = await s.stateDigest();
    await expect(run(persona, body(false))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(run(persona, body(true))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await s.stateDigest()).toBe(digest);
  });

  it('answers 404 to somebody who is not a member, and 401 to nobody', async () => {
    const digest = await s.stateDigest();
    await expect(run('outsider', body(false))).rejects.toBeInstanceOf(NotFoundError);
    await expect(run('newcomer', body(false))).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.prototypeImport.run(new Headers(), s.poolA, body(false)),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(run('owner', body(false), 'not-a-pool')).rejects.toBeInstanceOf(NotFoundError);
    expect(await s.stateDigest()).toBe(digest);
  });

  it('keeps pools apart: a pool of its own gets only its own import', async () => {
    await run('owner', body(false));
    const other = await run('outsider', body(false), s.poolB);
    expect(other.counts).toEqual(FIXTURE_COUNTS);
    expect((await tableCounts(s.poolA)).transactions).toBe(24);
    expect((await tableCounts(s.poolB)).transactions).toBe(24);
    // The owner of A cannot import into B, nor see what B got.
    await expect(run('owner', body(false), s.poolB)).rejects.toBeInstanceOf(NotFoundError);
    const owner = await s.as('owner');
    const ids = (await world.accounts.list(owner, s.poolA)).accounts.map((account) => account.id);
    const theirs = (await world.accounts.list(await s.as('outsider'), s.poolB)).accounts.map(
      (account) => account.id,
    );
    expect(ids.some((id) => theirs.includes(id))).toBe(false);
    expect(await auditEntries()).toHaveLength(2);
  });

  it('limits how often it can be called, per pool', async () => {
    for (let i = 0; i < 20; i += 1) await run('owner', { dryRun: true, export: {} });
    await expect(run('owner', { dryRun: true, export: {} })).rejects.toBeInstanceOf(RateLimitError);
    // Another pool has its own allowance.
    await expect(run('outsider', { dryRun: true, export: {} }, s.poolB)).resolves.toBeDefined();
  });
});

describe('prototype import: plan limits', () => {
  it('asks the plan before writing and refuses a Free pool up front, dry run included', async () => {
    const seen: { accounts: number; portfolios: number }[] = [];
    const limited = createPrototypeImportService({
      auth: world.auth,
      identity: world.identity,
      limiter: world.limiter,
      run: world.database.withPool,
      trustedProxyHops: 1,
      assertPlanLimits: (_ctx, wanted) => {
        seen.push(wanted);
        return wanted.accounts > 3 ? Promise.reject(new ForbiddenError()) : Promise.resolve();
      },
    });
    const headers = await s.as('owner');
    await expect(limited.run(headers, s.poolA, body(true))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(limited.run(headers, s.poolA, body(false))).rejects.toBeInstanceOf(ForbiddenError);
    expect(seen).toEqual([
      { accounts: 6, portfolios: 2 },
      { accounts: 6, portfolios: 2 },
    ]);
    expect(everythingEmpty(await tableCounts(s.poolA))).toBe(true);
  });
});
