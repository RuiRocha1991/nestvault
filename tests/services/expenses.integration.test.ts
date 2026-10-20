import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  logger,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  type ExpensesSummaryDto,
  type MovementTotalsDto,
} from '@nestvault/services';

import { createApiWorld, type ApiWorld, type Persona, type Scenario } from '../support/api-world';

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

const summary = async (as: Persona, query?: unknown, poolId = s.poolA) =>
  world.expenses.summary(await s.as(as), poolId, query);
const totals = async (as: Persona, query?: unknown, poolId = s.poolA) =>
  world.expenses.totals(await s.as(as), poolId, query);

async function category(key: string, poolId = s.poolA) {
  const found = (await world.categories.list(await s.as('owner'), poolId)).categories.find(
    (entry) => entry.systemKey === key,
  );
  if (!found) throw new Error(`No global category ${key}`);
  return found;
}

async function makeAccount(name: string, poolId = s.poolA, extra: Record<string, unknown> = {}) {
  // `outsider` owns pool B in the scenario.
  const headers = await s.as(poolId === s.poolA ? 'owner' : 'outsider');
  const [holder] = (await world.holders.list(headers, poolId)).holders;
  return world.accounts.create(headers, poolId, {
    type: 'checking',
    name,
    currency: 'EUR',
    holderIds: [holder?.id ?? ''],
    ...extra,
  });
}

const record = async (accountId: string, body: Record<string, unknown>, poolId = s.poolA) =>
  world.transactions.create(await s.as(poolId === s.poolA ? 'owner' : 'outsider'), poolId, {
    accountId,
    ...body,
  });

/** March 2026: salary 2 000, groceries 60 + 40 (budget 150), a refund of 10, an uncategorized 5. */
async function seedMarch() {
  const account = await makeAccount('BPI');
  const salary = await category('salary');
  const groceries = await category('groceries');
  const refunds = await category('refunds');
  await world.categories.updateSettings(await s.as('owner'), s.poolA, groceries.id, {
    monthlyBudget: '150',
  });
  await record(account.id, {
    date: '2026-03-05',
    description: 'SALARIO',
    amount: '2000',
    categoryId: salary.id,
  });
  await record(account.id, {
    date: '2026-03-06',
    description: 'COMPRA CONTINENTE',
    amount: '-60',
    categoryId: groceries.id,
  });
  await record(account.id, {
    date: '2026-03-07',
    description: 'COMPRA LIDL',
    amount: '-40',
    categoryId: groceries.id,
  });
  await record(account.id, {
    date: '2026-03-08',
    description: 'DEVOLUCAO',
    amount: '10',
    categoryId: refunds.id,
  });
  await record(account.id, { date: '2026-03-09', description: 'XPTO', amount: '-5' });
  return { account, groceries };
}

describe('expenses service: summary', () => {
  it('reports the month flows, the categories with their budget and twelve months of history', async () => {
    const { groceries } = await seedMarch();
    const result: ExpensesSummaryDto = await summary('viewer', { month: '2026-03' });

    expect(result.month).toBe('2026-03');
    expect(result.flow).toMatchObject({
      income: '2000',
      refunds: '10',
      // 60 + 40 + 5 spent, minus the refund
      expenses: '95',
      savings: '1905',
      savingsRate: '0.9525',
    });
    const top = result.categories[0];
    expect(top).toMatchObject({
      categoryId: groceries.id,
      value: '100',
      budget: '150',
      budgetUsed: '0.6666666666666666666666666666666666666667',
    });
    expect(result.categories.some((entry) => entry.categoryId === null)).toBe(true);
    expect(result.history).toHaveLength(12);
    expect(result.history.at(-1)).toEqual({ month: '2026-03', income: '2000', expenses: '95' });
    expect(result.history[0]?.month).toBe('2025-04');
  });

  it('answers the current month when none is given, and an empty pool with zeros', async () => {
    const result = await summary('owner');
    expect(result.history).toHaveLength(12);
    expect(result.flow).toMatchObject({ income: '0', expenses: '0', savingsRate: null });
    expect(result.categories).toEqual([]);
  });

  it('refuses a bad month and unknown fields (400), anonymous callers (401) and non-members (404)', async () => {
    await expect(summary('owner', { month: '2026-13' })).rejects.toBeInstanceOf(ValidationError);
    await expect(summary('owner', { poolId: s.poolB })).rejects.toBeInstanceOf(ValidationError);
    await expect(world.expenses.summary(new Headers(), s.poolA)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(summary('outsider')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('never counts the movements of another pool', async () => {
    const own = await makeAccount('A account');
    const other = await makeAccount('B account', s.poolB);
    await record(
      other.id,
      { date: '2026-03-06', description: 'SEGREDO B', amount: '-999' },
      s.poolB,
    );
    await record(own.id, { date: '2026-03-06', description: 'COMPRA A', amount: '-1' });
    const result = await summary('owner', { month: '2026-03' });
    expect(result.flow.expenses).toBe('1');
    expect(JSON.stringify(result)).not.toContain('999');
  });
});

describe('expenses service: totals', () => {
  it('sums income, net expenses and the uncategorized of the filter', async () => {
    const { account } = await seedMarch();
    const all: MovementTotalsDto = await totals('viewer');
    expect(all).toMatchObject({
      income: '2000',
      expenses: '95',
      invested: '0',
      transfers: '0',
      uncategorized: 1,
      count: 5,
      rates: {},
    });
    const one = await totals('member', { accountId: account.id, q: 'CONTINENTE' });
    expect(one).toMatchObject({ expenses: '60', income: '0', count: 1 });
    expect(await totals('member', { month: '2026-04' })).toMatchObject({ count: 0 });
  });

  it('treats an injection payload in the text as data', async () => {
    await seedMarch();
    expect(await totals('owner', { q: "' OR 1=1 --" })).toMatchObject({ count: 0 });
    expect(await totals('owner', { q: '%' })).toMatchObject({ count: 0 });
  });

  it('refuses unknown fields and filters that are not ones (400) and non-members (404)', async () => {
    await expect(totals('owner', { sort: 'amount' })).rejects.toBeInstanceOf(ValidationError);
    await expect(totals('owner', { accountId: 'x' })).rejects.toBeInstanceOf(ValidationError);
    await expect(totals('outsider')).rejects.toBeInstanceOf(NotFoundError);
  });
});
