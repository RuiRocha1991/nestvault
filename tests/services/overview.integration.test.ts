import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { lastMonths, monthFlows } from '@nestvault/domain';
import {
  createOverviewService,
  logger,
  NotFoundError,
  OverviewDto,
  UnauthorizedError,
  ValidationError,
} from '@nestvault/services';

import { createApiWorld, type ApiWorld, type Persona, type Scenario } from '../support/api-world';
import { fixtureLedger } from '../support/prototype-figures';
import { readFixtureJson } from '../support/prototype-fixture';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

let world: ApiWorld;
let s: Scenario;

// A fixed "today" so the month figures below can be worked out by hand.
const TODAY = new Date('2026-10-21T12:00:00Z');

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

const service = () =>
  createOverviewService({
    auth: world.auth,
    identity: world.identity,
    run: world.database.withPool,
    now: () => TODAY,
  });
const overview = async (as: Persona, query?: unknown, poolId = s.poolA) =>
  service().get(await s.as(as), poolId, query);

const holder = async (poolId = s.poolA) =>
  (await world.holders.list(await s.as('owner'), poolId)).holders[0]?.id ?? '';

/**
 * A small household whose figures are easy to check: a checking account opened with 1 000 EUR on
 * 2026-01-01, one salary and two expenses in October, one expense in September, a budget on two
 * categories and one position of 2 units bought at 80 and priced at 100.
 */
async function household() {
  const owner = await s.as('owner');
  const checking = await world.accounts.create(owner, s.poolA, {
    type: 'checking',
    name: 'Conta',
    currency: 'EUR',
    holderIds: [await holder()],
    opening: '1000',
    openingDate: '2026-01-01',
  });
  const categories = (await world.categories.list(owner, s.poolA)).categories;
  const key = (systemKey: string) => categories.find((c) => c.systemKey === systemKey)?.id ?? '';
  const movement = (date: string, amount: string, systemKey: string) =>
    world.transactions.create(owner, s.poolA, {
      accountId: checking.id,
      date,
      description: `Movimento ${date}`,
      amount,
      categoryId: key(systemKey),
    });
  await movement('2026-10-02', '1500', 'salary');
  await movement('2026-10-05', '-120', 'groceries');
  await movement('2026-10-12', '-30', 'housing');
  await movement('2026-09-10', '-200', 'groceries');
  await world.categories.updateSettings(owner, s.poolA, key('groceries'), { monthlyBudget: '400' });
  await world.categories.updateSettings(owner, s.poolA, key('housing'), { monthlyBudget: '600' });

  const portfolio = await world.portfolios.create(owner, s.poolA, {
    name: 'Longo prazo',
    color: '#9D6BFF',
    currency: 'EUR',
  });
  const asset = await world.assets.create(owner, s.poolA, {
    ticker: 'VWCE',
    name: 'Vanguard FTSE All-World',
    type: 'etf',
    currency: 'EUR',
  });
  await world.assets.setPrice(owner, s.poolA, asset.id, { date: '2026-10-20', price: '100' });
  await world.ops.create(owner, s.poolA, {
    portfolioId: portfolio.id,
    assetId: asset.id,
    type: 'buy',
    date: '2026-03-10',
    qty: '2',
    price: '80',
  });
  return { checking, portfolio, asset, key };
}

describe('overview service', () => {
  it('answers an empty pool with the call to action and zeroed figures', async () => {
    const result = await overview('owner');
    expect(OverviewDto.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      asOf: '2026-10-21',
      range: '12',
      empty: true,
      goals: [],
      portfolios: [],
    });
    expect(result.kpis.netWorth.value).toBe('0');
    expect(result.kpis.monthExpenses).toMatchObject({ value: '0', budget: null });
    expect(result.expenses.categories).toEqual([]);
    expect(result.evolution.months).toEqual(lastMonths(12, '2026-10-21'));
    expect(result.dividends.months).toHaveLength(12);
    expect(result.dividends.months[0]).toBe('2026-10');
  });

  it('computes the KPIs, the evolution, the donut and the portfolios from the pool', async () => {
    await household();
    const result = await overview('owner');
    expect(OverviewDto.parse(result)).toEqual(result);
    expect(result.empty).toBe(false);

    // Net worth: 1 000 + 1 500 − 120 − 30 − 200 in cash, plus 2 × 100 invested. End of September:
    // 800 in cash and the same position.
    expect(result.kpis.netWorth).toMatchObject({ value: '2350', changePct: '135' });
    expect(result.kpis.netWorth.spark).toHaveLength(12);
    expect(result.evolution.total.at(-1)).toBe('2350');
    expect(result.evolution.total.at(-2)).toBe('1000');
    expect(result.evolution.investments.at(-1)).toBe('200');

    // 2 units bought at 80, worth 100: +25 % on the cost.
    expect(result.kpis.investments).toMatchObject({ value: '200', returnPct: '25' });
    expect(result.portfolios).toEqual([
      expect.objectContaining({ name: 'Longo prazo', currency: 'EUR', value: '200', returnPct: '25' }),
    ]);

    // October: 120 + 30 of expenses against a 1 000 budget, 25 % less than September's 200.
    expect(result.kpis.monthExpenses).toMatchObject({
      value: '150',
      budget: '1000',
      budgetUsedPct: '15',
      changePct: '-25',
    });
    expect(result.expenses).toMatchObject({ month: '2026-10', total: '150' });
    expect(result.expenses.categories.map((c) => [c.systemKey, c.value])).toEqual([
      ['groceries', '120'],
      ['housing', '30'],
    ]);

    // No dividend per share is known: nothing to forecast, no passive income.
    expect(result.kpis.passiveIncome).toMatchObject({ annual: '0', interest12: '0' });
    expect(result.dividends.total).toBe('0');
  });

  it('draws the chart over 6, 12 or 24 months, or over everything since the first record', async () => {
    await household();
    const months = async (range: string) =>
      (await overview('owner', { range })).evolution.months;
    expect(await months('6')).toEqual(lastMonths(6, '2026-10-21'));
    expect(await months('24')).toHaveLength(24);
    // The first record is the opening balance of January 2026: ten months up to October.
    expect(await months('all')).toEqual(lastMonths(10, '2026-10-21'));
  });

  it('matches the prototype month flows for the imported prototype data', async () => {
    const raw = readFixtureJson();
    const owner = await s.as('owner');
    await world.prototypeImport.run(owner, s.poolA, { dryRun: false, export: raw });
    const result = await overview('owner', { range: '24' });

    // The same domain function over the prototype's own file gives the same monthly expenses.
    const months = result.evolution.months;
    const expected = monthFlows(fixtureLedger(raw), months).map((flow) => flow.expenses.toFixed());
    expect(result.kpis.monthExpenses.spark.map((value) => Number(value))).toEqual(
      expected.map((value) => Number(value)),
    );
    expect(result.kpis.investments.value).toBe('2114');
    expect(result.empty).toBe(false);
  });

  it('is readable by every role, including a viewer', async () => {
    await household();
    for (const as of ['owner', 'admin', 'member', 'viewer'] as const) {
      expect((await overview(as)).kpis.netWorth.value).toBe('2350');
    }
  });

  it('refuses a bad query (400): unknown range and extra fields such as poolId', async () => {
    await expect(overview('owner', { range: '7' })).rejects.toBeInstanceOf(ValidationError);
    await expect(overview('owner', { range: "6' OR 1=1 --" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(overview('owner', { poolId: s.poolB })).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses a request without a session (401) and hides the pool from a non-member (404)', async () => {
    await household();
    await expect(service().get(new Headers(), s.poolA)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(overview('outsider')).rejects.toBeInstanceOf(NotFoundError);
    await expect(overview('owner', {}, 'not-a-pool')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('never shows another pool’s data', async () => {
    // Pool B (owned by `outsider`) has a portfolio; pool A has nothing.
    await world.portfolios.create(await s.as('outsider'), s.poolB, {
      name: 'Carteira Beta Secreta',
      color: '#445566',
      currency: 'USD',
    });
    const mine = await overview('owner');
    expect(mine.empty).toBe(true);
    expect(mine.portfolios).toEqual([]);
    expect(JSON.stringify(mine)).not.toContain('Beta');
    const theirs = await overview('outsider', {}, s.poolB);
    expect(theirs.portfolios.map((p) => p.name)).toEqual(['Carteira Beta Secreta']);
  });
});
