import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ConflictError,
  ForbiddenError,
  logger,
  NotFoundError,
  OpDto,
  PlanDto,
  PlanRunDto,
  PortfolioDto,
  PortfolioSummaryDto,
  createPortfoliosService,
  UnauthorizedError,
  ValidationError,
} from '@nestvault/services';

import { createApiWorld, type ApiWorld, type Persona, type Scenario } from '../support/api-world';
import { rows } from '../support/auth-harness';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

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

const portfolio = async (as: Persona, body: unknown = {}, poolId = s.poolA) =>
  world.portfolios.create(await s.as(as), poolId, {
    name: 'Reforma',
    color: '#112233',
    currency: 'EUR',
    ...(body as object),
  });
const asset = async (as: Persona = 'owner', body: unknown = {}, poolId = s.poolA) =>
  world.assets.create(await s.as(as), poolId, {
    ticker: 'VWCE',
    name: 'Vanguard FTSE All-World',
    type: 'etf',
    currency: 'EUR',
    ...(body as object),
  });
const holder = async (poolId = s.poolA) =>
  (await world.holders.list(await s.as('owner'), poolId)).holders[0]?.id ?? '';
const account = async (type: string, name: string, extra: object = {}, poolId = s.poolA) =>
  world.accounts.create(await s.as('owner'), poolId, {
    type,
    name,
    currency: 'EUR',
    holderIds: [await holder(poolId)],
    ...extra,
  });
const createOp = async (as: Persona, body: unknown, poolId = s.poolA) =>
  world.ops.create(await s.as(as), poolId, body);

/** A portfolio and an asset of pool A, and a valid buy body for them. */
async function setup() {
  const p = await portfolio('owner');
  const x = await asset();
  return {
    p,
    x,
    buy: {
      portfolioId: p.id,
      assetId: x.id,
      type: 'buy',
      date: '2026-03-10',
      qty: '2',
      price: '10',
    },
  };
}

describe('portfolios service', () => {
  it('lets owner and admin create, change and delete; refuses member and viewer (403)', async () => {
    const created = await portfolio('owner', { note: 'Para a reforma', targets: { etf: '60' } });
    expect(PortfolioDto.parse(created)).toEqual(created);
    expect(created).toMatchObject({ name: 'Reforma', targets: { etf: '60' }, opsCount: 0 });
    const updated = await world.portfolios.update(await s.as('admin'), s.poolA, created.id, {
      name: 'Filhos',
      note: null,
    });
    expect(updated).toMatchObject({ name: 'Filhos', note: null, targets: { etf: '60' } });
    for (const as of ['member', 'viewer'] as const) {
      await expect(portfolio(as, { name: 'x' })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        world.portfolios.update(await s.as(as), s.poolA, created.id, { name: 'x' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        world.portfolios.remove(await s.as(as), s.poolA, created.id),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    await world.portfolios.remove(await s.as('owner'), s.poolA, created.id);
    expect((await world.portfolios.list(await s.as('viewer'), s.poolA)).portfolios).toEqual([]);
  });

  it('answers 409 for a repeated name and 400 for bad or extra fields', async () => {
    await portfolio('owner');
    await expect(portfolio('owner')).rejects.toBeInstanceOf(ConflictError);
    for (const bad of [
      { poolId: s.poolB },
      { id: '0192f3a1-0000-7000-8000-000000000001' },
      { color: 'red' },
      { currency: 'JPY' },
      { name: '' },
      { targets: { etf: '101' } },
      { targets: { etf: 'abc' } },
    ]) {
      await expect(portfolio('owner', { name: 'Outra', ...bad })).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
  });

  it('hides the pool from a non-member and refuses a request without a session', async () => {
    const mine = await portfolio('owner');
    await expect(world.portfolios.list(new Headers(), s.poolA)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(world.portfolios.list(await s.as('outsider'), s.poolA)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      world.portfolios.get(await s.as('outsider'), s.poolB, mine.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.portfolios.update(await s.as('outsider'), s.poolB, mine.id, { name: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.portfolios.get(await s.as('owner'), s.poolA, 'not-an-id'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses to delete a portfolio with operations (409) unless they are moved or deleted', async () => {
    const { p, buy } = await setup();
    const other = await portfolio('owner', { name: 'Outra' });
    await createOp('owner', buy);
    await createOp('member', buy);
    const del = async (query?: unknown, id = p.id) =>
      world.portfolios.remove(await s.as('owner'), s.poolA, id, query);

    await expect(del()).rejects.toBeInstanceOf(ConflictError);
    await expect(del({ deleteOps: 'false' })).rejects.toBeInstanceOf(ConflictError);
    await expect(del({ moveTo: other.id, deleteOps: 'true' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(del({ moveTo: p.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(del({ moveTo: '0192f3a1-0000-7000-8000-000000000001' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect((await world.ops.list(await s.as('owner'), s.poolA)).ops).toHaveLength(2);

    await del({ moveTo: other.id });
    const moved = (await world.ops.list(await s.as('owner'), s.poolA)).ops;
    expect(moved).toHaveLength(2);
    expect(moved.every((op) => op.portfolioId === other.id)).toBe(true);
    expect((await world.portfolios.get(await s.as('owner'), s.poolA, other.id)).opsCount).toBe(2);

    await del({ deleteOps: 'true' }, other.id);
    expect((await world.ops.list(await s.as('owner'), s.poolA)).ops).toEqual([]);
  });

  it('treats plans like operations when deleting: 409, then moved or deleted with the portfolio', async () => {
    const { p, x } = await setup();
    const other = await portfolio('owner', { name: 'Outra' });
    const owner = await s.as('owner');
    const planBody = { portfolioId: p.id, assetId: x.id, amount: '50', day: 3 };
    const plan = await world.plans.create(owner, s.poolA, planBody);
    expect(await world.portfolios.get(owner, s.poolA, p.id)).toMatchObject({
      opsCount: 0,
      plansCount: 1,
    });
    expect(
      (await world.portfolios.list(owner, s.poolA)).portfolios.map((q) => q.plansCount),
    ).toEqual([1, 0]);
    await expect(world.portfolios.remove(owner, s.poolA, p.id)).rejects.toBeInstanceOf(
      ConflictError,
    );

    await world.portfolios.remove(owner, s.poolA, p.id, { moveTo: other.id });
    expect(await world.plans.get(owner, s.poolA, plan.id)).toMatchObject({ portfolioId: other.id });
    expect(await world.portfolios.get(owner, s.poolA, other.id)).toMatchObject({ plansCount: 1 });

    await world.portfolios.remove(owner, s.poolA, other.id, { deleteOps: 'true' });
    expect((await world.plans.list(owner, s.poolA)).plans).toEqual([]);
  });

  it('answers 409, not 500, when an operation lands between the count and the delete', async () => {
    const { p } = await setup();
    const racing = createPortfoliosService({
      auth: world.auth,
      identity: world.identity,
      trustedProxyHops: 1,
      // The restrict foreign key is what Postgres raises when the operation wins the race.
      run: () => Promise.reject(new Error('delete failed', { cause: { code: '23503' } })),
    });
    await expect(racing.remove(await s.as('owner'), s.poolA, p.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('refuses another pool’s portfolio as the destination of the move', async () => {
    const { p, buy } = await setup();
    await createOp('owner', buy);
    const foreign = await portfolio('outsider', { name: 'Alheia' }, s.poolB);
    await expect(
      world.portfolios.remove(await s.as('owner'), s.poolA, p.id, { moveTo: foreign.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await world.ops.list(await s.as('owner'), s.poolA)).ops).toHaveLength(1);
  });

  it('records the changes in the audit log without the portfolio’s data', async () => {
    const created = await portfolio('owner', { note: 'segredo-da-nota' });
    await world.portfolios.remove(await s.as('owner'), s.poolA, created.id);
    const log = await rows<{ action: string; entry: string }>(
      world.identity,
      sql`select action, to_jsonb(audit_log)::text as entry from audit_log where action like 'portfolio.%' and target = ${created.id} order by at`,
    );
    expect(log.map((row) => row.action)).toEqual(['portfolio.created', 'portfolio.deleted']);
    expect(JSON.stringify(log)).not.toContain('segredo-da-nota');
  });
});

describe('investment operations service', () => {
  it('lets owner, admin and member record operations; refuses the viewer (403)', async () => {
    const { buy } = await setup();
    for (const as of ['owner', 'admin', 'member'] as const) {
      const op = await createOp(as, buy);
      expect(OpDto.parse(op)).toEqual(op);
    }
    await expect(createOp('viewer', buy)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await world.ops.list(await s.as('viewer'), s.poolA)).ops).toHaveLength(3);
  });

  it('validates each type: trades need qty > 0 and a price, dividends need the net amount', async () => {
    const { buy } = await setup();
    for (const bad of [
      { qty: '0' },
      { qty: '-1' },
      { qty: undefined },
      { price: undefined },
      { price: '-1' },
      { qty: '1.123456789' },
      { fee: '-1' },
      { type: 'dividend', qty: undefined, price: undefined },
      { type: 'split' },
      { extId: 'x' },
      { planId: '0192f3a1-0000-7000-8000-000000000001' },
      { poolId: s.poolB },
    ]) {
      await expect(createOp('owner', { ...buy, ...bad })).rejects.toBeInstanceOf(ValidationError);
    }
    const sell = await createOp('owner', { ...buy, type: 'sell', price: '0' });
    expect(sell).toMatchObject({ type: 'sell', qty: '2', price: '0' });
  });

  it('keeps only the fields of the type: a dividend has no qty and a buy has no amount', async () => {
    const { buy } = await setup();
    const dividend = await createOp('owner', {
      ...buy,
      type: 'dividend',
      qty: '5',
      price: '3',
      amount: '34',
      gross: '40',
      tax: '6',
    });
    expect(dividend).toMatchObject({ qty: null, price: null, amount: '34', gross: '40', tax: '6' });
    const trade = await createOp('owner', { ...buy, amount: '99', gross: '1', tax: '1' });
    expect(trade).toMatchObject({ amount: null, gross: null, tax: null, qty: '2' });
  });

  it('rejects a sub-account of another account, a non-cash account and a sub-account without account', async () => {
    const { buy } = await setup();
    const one = await account('brokerage', 'XTB', { subAccounts: [{ name: 'Sub 1' }] });
    const two = await account('brokerage', 'Banco Invest', { subAccounts: [{ name: 'Sub 2' }] });
    const savings = await account('savings', 'Poupança');
    const checking = await account('checking', 'Ordenado');
    const subOne = one.subAccounts[0]?.id ?? '';
    const subTwo = two.subAccounts[0]?.id ?? '';

    const ok = await createOp('owner', { ...buy, accountId: one.id, subAccountId: subOne });
    expect(ok).toMatchObject({ accountId: one.id, subAccountId: subOne });
    await createOp('owner', { ...buy, accountId: checking.id });

    for (const bad of [
      { accountId: one.id, subAccountId: subTwo },
      { accountId: two.id, subAccountId: subOne },
      { accountId: savings.id },
      { subAccountId: subOne },
      { accountId: '0192f3a1-0000-7000-8000-000000000001' },
    ]) {
      await expect(createOp('owner', { ...buy, ...bad })).rejects.toBeInstanceOf(ValidationError);
    }
    // The same rule when an existing operation is changed.
    await expect(
      world.ops.update(await s.as('owner'), s.poolA, ok.id, { subAccountId: subTwo }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await world.ops.get(await s.as('owner'), s.poolA, ok.id)).toEqual(ok);
  });

  it('refuses a portfolio or an asset of another pool', async () => {
    const { buy } = await setup();
    const foreignPortfolio = await portfolio('outsider', { name: 'Alheia' }, s.poolB);
    const foreignAsset = await asset('outsider', { ticker: 'BETA' }, s.poolB);
    await expect(
      createOp('owner', { ...buy, portfolioId: foreignPortfolio.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(createOp('owner', { ...buy, assetId: foreignAsset.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('updates as a whole, clears the sub-account with the account, and deletes', async () => {
    const { buy } = await setup();
    const acc = await account('brokerage', 'XTB', { subAccounts: [{ name: 'Sub 1' }] });
    const op = await createOp('owner', {
      ...buy,
      accountId: acc.id,
      subAccountId: acc.subAccounts[0]?.id,
      note: 'primeira',
    });
    const changed = await world.ops.update(await s.as('member'), s.poolA, op.id, {
      qty: '4',
      note: null,
      accountId: null,
    });
    expect(changed).toMatchObject({
      qty: '4',
      price: '10',
      note: null,
      accountId: null,
      subAccountId: null,
    });
    // A dividend needs its amount, so turning the buy into one without it fails and changes nothing.
    await expect(
      world.ops.update(await s.as('owner'), s.poolA, op.id, { type: 'dividend' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await world.ops.get(await s.as('owner'), s.poolA, op.id)).toEqual(changed);
    await expect(world.ops.update(await s.as('owner'), s.poolA, op.id, {})).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(world.ops.remove(await s.as('viewer'), s.poolA, op.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await world.ops.remove(await s.as('member'), s.poolA, op.id);
    await expect(world.ops.get(await s.as('owner'), s.poolA, op.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(world.ops.remove(await s.as('owner'), s.poolA, op.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('clears the sub-account when the account changes without a new one', async () => {
    const { buy } = await setup();
    const first = await account('brokerage', 'XTB', { subAccounts: [{ name: 'Sub 1' }] });
    const second = await account('brokerage', 'Trade Republic');
    const op = await createOp('owner', {
      ...buy,
      accountId: first.id,
      subAccountId: first.subAccounts[0]?.id,
    });
    const moved = await world.ops.update(await s.as('owner'), s.poolA, op.id, {
      accountId: second.id,
    });
    expect(moved).toMatchObject({ accountId: second.id, subAccountId: null });
    // Sending the same account keeps the sub-account.
    const kept = await world.ops.update(await s.as('owner'), s.poolA, op.id, {
      accountId: first.id,
      subAccountId: first.subAccounts[0]?.id,
    });
    const same = await world.ops.update(await s.as('owner'), s.poolA, op.id, {
      accountId: first.id.toUpperCase(),
    });
    expect(same.subAccountId).toBe(kept.subAccountId);
  });

  it('blocks deleting a sub-account that operations use, and changing the type of an account with operations (409)', async () => {
    const { buy } = await setup();
    const acc = await account('brokerage', 'XTB', { subAccounts: [{ name: 'Sub 1' }] });
    const sub = acc.subAccounts[0]?.id ?? '';
    await createOp('owner', { ...buy, accountId: acc.id, subAccountId: sub });
    const owner = await s.as('owner');
    await expect(
      world.accounts.removeSubAccount(owner, s.poolA, acc.id, sub),
    ).rejects.toBeInstanceOf(ConflictError);
    const plain = await account('checking', 'Conta à ordem');
    await createOp('owner', { ...buy, accountId: plain.id });
    await expect(
      world.accounts.update(owner, s.poolA, plain.id, { type: 'savings' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('filters the list, ignores injection payloads in filters, and keeps notes as plain data', async () => {
    const { p, x, buy } = await setup();
    const payload = "'; DROP TABLE investment_ops; --";
    await createOp('owner', { ...buy, note: payload });
    await createOp('owner', { ...buy, date: '2026-05-01', type: 'sell' });
    const list = async (query: unknown) =>
      (await world.ops.list(await s.as('viewer'), s.poolA, query)).ops;
    expect(await list({})).toHaveLength(2);
    expect((await list({})).map((op) => op.date)).toEqual(['2026-05-01', '2026-03-10']);
    expect(await list({ type: 'sell' })).toHaveLength(1);
    expect(await list({ from: '2026-04-01' })).toHaveLength(1);
    expect(await list({ portfolioId: p.id, assetId: x.id, limit: '1' })).toHaveLength(1);
    expect((await list({ portfolioId: p.id })).find((op) => op.note)?.note).toBe(payload);
    await expect(list({ type: "buy' OR 1=1 --" })).rejects.toBeInstanceOf(ValidationError);
    await expect(list({ portfolioId: "x' OR 1=1 --" })).rejects.toBeInstanceOf(ValidationError);
    await expect(list({ poolId: s.poolB })).rejects.toBeInstanceOf(ValidationError);
  });

  it('never shows or changes another pool’s operations', async () => {
    const { buy } = await setup();
    const mine = await createOp('owner', buy);
    await expect(world.ops.list(await s.as('outsider'), s.poolA)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(world.ops.get(await s.as('outsider'), s.poolB, mine.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      world.ops.update(await s.as('outsider'), s.poolB, mine.id, { qty: '9' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(world.ops.remove(await s.as('outsider'), s.poolB, mine.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await world.ops.get(await s.as('owner'), s.poolA, mine.id)).toEqual(mine);
  });

  it('blocks deleting an asset or an account that operations use (409)', async () => {
    const { x, buy } = await setup();
    const acc = await account('brokerage', 'XTB');
    await createOp('owner', { ...buy, accountId: acc.id });
    await expect(world.assets.remove(await s.as('owner'), s.poolA, x.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(
      world.accounts.remove(await s.as('owner'), s.poolA, acc.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('portfolio summary (XTB account 50611139 fixture)', () => {
  // The same figures as tests/domain/portfolio-summary.test.ts, now read from the database: a USD
  // ETF priced 135.062, ten bought at 120, three dividends, and an account worth 11.25 in cash.
  async function xtb() {
    const p = await portfolio('owner', { name: 'XTB', currency: 'USD' });
    const x = await asset('owner', { ticker: 'ETFUSD', currency: 'USD' });
    await world.assets.setPrice(await s.as('owner'), s.poolA, x.id, {
      date: '2026-01-02',
      price: '135.062',
    });
    // Opening balance chosen so the cash after the operations is 11.25.
    const acc = await account('brokerage', 'XTB', { currency: 'USD', opening: '1146.95' });
    const base = { portfolioId: p.id, assetId: x.id, accountId: acc.id };
    await createOp('owner', { ...base, type: 'buy', date: '2025-01-10', qty: '10', price: '120' });
    for (const [date, amount, gross, tax] of [
      ['2025-06-10', '34', '40', '6'],
      ['2025-12-10', '26.06', '30.75', '4.69'],
      ['2026-02-10', '4.24', '0', '-4.24'],
    ] as const) {
      await createOp('owner', { ...base, type: 'dividend', date, amount, gross, tax });
    }
    return { p, x, acc };
  }
  const summary = async (as: Persona, query: unknown = { asOf: '2026-09-01' }) =>
    world.portfolios.summary(await s.as(as), s.poolA, query);

  it('returns the domain results by currency and in EUR', async () => {
    await xtb();
    const result = await summary('viewer');
    expect(PortfolioSummaryDto.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      asOf: '2026-09-01',
      portfolioId: null,
      divGrossBy: { USD: '70.75' },
      taxBy: { USD: '-10.69' },
      refundBy: { USD: '4.24' },
      cashBy: { USD: '11.25', EUR: '0' },
      divsBy: { USD: '64.3' },
      valueBy: { USD: '1350.62' },
      valueAllBy: { USD: '1361.87', EUR: '0' },
      profitBy: { USD: '214.92' },
      positions: 1,
    });
    expect(Number(result.valueAll)).toBeCloseTo(1252.92, 2);
    expect(Number(result.profitPct)).toBeCloseTo(214.92 / 1146.95, 6);
    expect(result.irr === null || Number.isFinite(result.irr)).toBe(true);
  });

  it('narrows to one portfolio, and an empty portfolio has an empty summary', async () => {
    const { p } = await xtb();
    const empty = await portfolio('owner', { name: 'Vazia' });
    expect(await summary('owner', { asOf: '2026-09-01', portfolioId: p.id })).toMatchObject({
      portfolioId: p.id,
      valueBy: { USD: '1350.62' },
    });
    expect(await summary('owner', { asOf: '2026-09-01', portfolioId: empty.id })).toMatchObject({
      positions: 0,
      valueBy: {},
    });
  });

  it('is limited to the pool: another pool’s portfolio is 404 and a stranger gets 404', async () => {
    await xtb();
    const foreign = await portfolio('outsider', { name: 'Alheia' }, s.poolB);
    await expect(summary('owner', { portfolioId: foreign.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(summary('outsider')).rejects.toBeInstanceOf(NotFoundError);
    await expect(summary('owner', { asOf: 'tomorrow' })).rejects.toBeInstanceOf(ValidationError);
    const b = await world.portfolios.summary(await s.as('outsider'), s.poolB, {});
    expect(b.positions).toBe(0);
  });
});

describe('plans service', () => {
  async function planSetup(extra: object = {}) {
    const { p, x } = await setup();
    await world.assets.setPrice(await s.as('owner'), s.poolA, x.id, {
      date: '2026-01-02',
      price: '20',
    });
    const plan = await world.plans.create(await s.as('owner'), s.poolA, {
      portfolioId: p.id,
      assetId: x.id,
      amount: '100',
      day: 5,
      ...extra,
    });
    return { p, x, plan };
  }
  const run = async (as: Persona, id: string, body: unknown = { month: '2026-03' }) =>
    world.plans.run(await s.as(as), s.poolA, id, body);

  it('lets owner and admin manage plans; member and viewer get 403', async () => {
    const { p, x, plan } = await planSetup();
    expect(PlanDto.parse(plan)).toEqual(plan);
    expect(plan).toMatchObject({ amount: '100', day: 5, active: true });
    const changed = await world.plans.update(await s.as('admin'), s.poolA, plan.id, {
      day: 28,
      active: false,
    });
    expect(changed).toMatchObject({ day: 28, active: false, amount: '100' });
    expect(
      (await world.plans.list(await s.as('viewer'), s.poolA, { portfolioId: p.id })).plans,
    ).toHaveLength(1);
    for (const as of ['member', 'viewer'] as const) {
      await expect(
        world.plans.create(await s.as(as), s.poolA, {
          portfolioId: p.id,
          assetId: x.id,
          amount: '1',
          day: 1,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        world.plans.update(await s.as(as), s.poolA, plan.id, { day: 1 }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(world.plans.remove(await s.as(as), s.poolA, plan.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    await world.plans.remove(await s.as('owner'), s.poolA, plan.id);
    expect((await world.plans.list(await s.as('owner'), s.poolA)).plans).toEqual([]);
  });

  it('validates the amount, the day, the account and what belongs to the pool', async () => {
    const { p, x } = await planSetup();
    const foreignAsset = await asset('outsider', { ticker: 'BETA' }, s.poolB);
    const savings = await account('savings', 'Poupança');
    const body = { portfolioId: p.id, assetId: x.id, amount: '50', day: 10 };
    for (const bad of [
      { amount: '0' },
      { amount: '-5' },
      { day: 0 },
      { day: 29 },
      { day: 1.5 },
      { poolId: s.poolB },
      { assetId: foreignAsset.id },
      { accountId: savings.id },
      { subAccountId: '0192f3a1-0000-7000-8000-000000000001' },
    ]) {
      await expect(
        world.plans.create(await s.as('owner'), s.poolA, { ...body, ...bad }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it('registers the month’s buy at the latest price, and a second run changes nothing', async () => {
    const { plan } = await planSetup();
    const first = await run('member', plan.id);
    expect(PlanRunDto.parse(first)).toEqual(first);
    expect(first.created).toBe(true);
    expect(first.op).toMatchObject({
      type: 'buy',
      date: '2026-03-05',
      qty: '5',
      price: '20',
      planId: plan.id,
    });
    const again = await run('owner', plan.id);
    expect(again).toEqual({ created: false, op: first.op });
    expect((await world.ops.list(await s.as('owner'), s.poolA)).ops).toHaveLength(1);

    const next = await run('owner', plan.id, { month: '2026-04' });
    expect(next.created).toBe(true);
    expect(next.op.date).toBe('2026-04-05');
    expect((await world.ops.list(await s.as('owner'), s.poolA)).ops).toHaveLength(2);
  });

  it('is idempotent when two runs race', async () => {
    const { plan } = await planSetup();
    const results = await Promise.all([run('owner', plan.id), run('admin', plan.id)]);
    expect(results.map((r) => r.created).sort()).toEqual([false, true]);
    expect(results[0].op.id).toBe(results[1].op.id);
    expect((await world.ops.list(await s.as('owner'), s.poolA)).ops).toHaveLength(1);
  });

  it('defaults to the current month and never dates the buy in the future', async () => {
    const { plan } = await planSetup({ day: 28 });
    const result = await run('owner', plan.id, {});
    const today = new Date().toISOString().slice(0, 10);
    expect(result.op.date.slice(0, 7)).toBe(today.slice(0, 7));
    expect(result.op.date <= today).toBe(true);
  });

  it('refuses to run an inactive plan or an asset without a price, and checks permission and month', async () => {
    const { plan } = await planSetup();
    await expect(run('viewer', plan.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(run('owner', plan.id, { month: '2026-13' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      run('owner', plan.id, { month: '2026-03', poolId: s.poolB }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Before the first price there is nothing to buy at.
    await expect(run('owner', plan.id, { month: '2025-12' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await world.plans.update(await s.as('owner'), s.poolA, plan.id, { active: false });
    await expect(run('owner', plan.id)).rejects.toBeInstanceOf(ConflictError);
    expect((await world.ops.list(await s.as('owner'), s.poolA)).ops).toEqual([]);
  });

  it('keeps the registered buy after the plan is deleted, and still answers “already run” never', async () => {
    const { plan } = await planSetup();
    const first = await run('owner', plan.id);
    await world.plans.remove(await s.as('owner'), s.poolA, plan.id);
    const kept = await world.ops.get(await s.as('owner'), s.poolA, first.op.id);
    expect(kept).toMatchObject({ qty: '5', planId: null });
    await expect(run('owner', plan.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a month that has not started, and an amount too small to buy anything', async () => {
    const { plan } = await planSetup();
    const next = new Date();
    next.setUTCMonth(next.getUTCMonth() + 1);
    await expect(
      run('owner', plan.id, { month: next.toISOString().slice(0, 7) }),
    ).rejects.toBeInstanceOf(ValidationError);

    const tiny = await world.plans.create(await s.as('owner'), s.poolA, {
      portfolioId: plan.portfolioId,
      assetId: plan.assetId,
      amount: '0.0001',
      day: 5,
    });
    const priceyAsset = await asset('owner', { ticker: 'BRK.A', name: 'Berkshire' });
    await world.assets.setPrice(await s.as('owner'), s.poolA, priceyAsset.id, {
      date: '2026-01-02',
      price: '900000',
    });
    const pricey = await world.plans.update(await s.as('owner'), s.poolA, tiny.id, {
      assetId: priceyAsset.id,
    });
    await expect(run('owner', pricey.id)).rejects.toBeInstanceOf(ValidationError);
    expect((await world.ops.list(await s.as('owner'), s.poolA)).ops).toEqual([]);
  });

  it('clears the sub-account when the account changes, and blocks deleting what a plan uses (409)', async () => {
    const first = await account('brokerage', 'XTB', { subAccounts: [{ name: 'Sub 1' }] });
    const second = await account('brokerage', 'Trade Republic');
    const { plan, x } = await planSetup({
      accountId: first.id,
      subAccountId: first.subAccounts[0]?.id,
    });
    const owner = await s.as('owner');
    expect(plan.subAccountId).toBe(first.subAccounts[0]?.id);
    await expect(world.accounts.remove(owner, s.poolA, first.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(
      world.accounts.removeSubAccount(owner, s.poolA, first.id, first.subAccounts[0]?.id ?? ''),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(world.assets.remove(owner, s.poolA, x.id)).rejects.toBeInstanceOf(ConflictError);

    const moved = await world.plans.update(owner, s.poolA, plan.id, { accountId: second.id });
    expect(moved).toMatchObject({ accountId: second.id, subAccountId: null });
    await expect(
      world.accounts.update(owner, s.poolA, second.id, { type: 'savings' }),
    ).rejects.toBeInstanceOf(ConflictError);
    await world.accounts.remove(owner, s.poolA, first.id);
  });

  it('never shows or runs another pool’s plans', async () => {
    const { plan } = await planSetup();
    await expect(world.plans.list(await s.as('outsider'), s.poolA)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const outsider = await s.as('outsider');
    for (const call of [
      () => world.plans.get(outsider, s.poolB, plan.id),
      () => world.plans.update(outsider, s.poolB, plan.id, { day: 2 }),
      () => world.plans.remove(outsider, s.poolB, plan.id),
      () => world.plans.run(outsider, s.poolB, plan.id, {}),
    ]) {
      await expect(call()).rejects.toSatisfy(
        (error) => error instanceof NotFoundError || error instanceof ForbiddenError,
      );
    }
    expect(await world.plans.get(await s.as('owner'), s.poolA, plan.id)).toEqual(plan);
  });
});
