import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  logger,
  MonthReviewDto,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
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

const ownerOf = (poolId: string): Persona => (poolId === s.poolB ? 'outsider' : 'owner');

/** A checking account with a salary, an expense carrying a note and a purchase in March 2026. */
async function seed(poolId = s.poolA) {
  const headers = await s.as(ownerOf(poolId));
  const [holder] = (await world.holders.list(headers, poolId)).holders;
  const account = await world.accounts.create(headers, poolId, {
    type: 'checking',
    name: 'Conta Ordenado',
    currency: 'EUR',
    holderIds: [holder?.id ?? ''],
  });
  const create = (date: string, description: string, amount: string) =>
    world.transactions.create(headers, poolId, {
      accountId: account.id,
      date,
      description,
      amount,
    });
  const salary = await create('2026-03-01', 'ORDENADO MARCO', '1000');
  const expense = await create('2026-03-10', 'COMPRA CONTINENTE', '-50');
  await create('2026-02-10', 'COMPRA FEVEREIRO', '-30');
  await world.notes.setTransactionNote(headers, poolId, expense.id, {
    note: 'Compras da festa 4711',
  });
  const portfolio = await world.portfolios.create(headers, poolId, {
    name: 'Reforma',
    color: '#112233',
    currency: 'EUR',
  });
  const asset = await world.assets.create(headers, poolId, {
    ticker: 'VWCE',
    name: 'Vanguard FTSE All-World',
    type: 'etf',
    currency: 'EUR',
  });
  const op = await world.ops.create(headers, poolId, {
    portfolioId: portfolio.id,
    assetId: asset.id,
    type: 'buy',
    date: '2026-03-15',
    qty: '3',
    price: '10',
  });
  return { account, salary, expense, op, portfolio };
}

const review = async (as: Persona, month: string, poolId = s.poolA) =>
  world.months.review(await s.as(as), poolId, month);

describe('monthly review service', () => {
  it('returns the figures, notable transactions, operations and timeline to every member', async () => {
    const { expense, op, portfolio } = await seed();
    await world.notes.putMonthNote(await s.as('owner'), s.poolA, '2026-03', {
      body: 'Mês de festa',
      expectedUpdatedAt: null,
    });

    for (const persona of ['owner', 'admin', 'member', 'viewer'] as const) {
      const result = await review(persona, '2026-03');
      expect(MonthReviewDto.parse(result)).toEqual(result);
      expect(Number(result.income)).toBe(1000);
      expect(Number(result.expenses)).toBe(50);
      expect(Number(result.savings)).toBe(950);
      expect(Number(result.savingsRatePct)).toBe(95);
      expect(Number(result.invested)).toBe(30);
      expect(result.previousMonth).toBe('2026-02');
      expect(result.nextMonth).toBeNull();
      expect(result.note.body).toBe('Mês de festa');
    }

    const result = await review('viewer', '2026-03');
    const notable = result.notable.find((n) => n.id === expense.id);
    expect(notable).toMatchObject({
      description: 'COMPRA CONTINENTE',
      accountName: 'Conta Ordenado',
      note: 'Compras da festa 4711',
      noteUpdatedBy: s.ids.owner,
    });
    expect(notable?.reasons).toEqual(expect.arrayContaining(['note', 'top-expense']));
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({
      portfolioId: portfolio.id,
      portfolioName: 'Reforma',
    });
    expect(result.operations[0]?.operations[0]).toMatchObject({ id: op.id, ticker: 'VWCE' });

    // Twelve months ending with the reviewed one; only March has a note.
    expect(result.timeline).toHaveLength(12);
    expect(result.timeline.at(-1)).toMatchObject({ month: '2026-03', hasNote: true });
    expect(result.timeline[0]?.month).toBe('2025-04');
    expect(result.timeline.filter((m) => m.hasNote)).toHaveLength(1);
  });

  it('offers the next month before the current one and none for an empty month', async () => {
    const past = await review('owner', '2025-11');
    expect(past.nextMonth).toBe('2025-12');
    expect(past.previousMonth).toBe('2025-10');
    expect(Number(past.income)).toBe(0);
    expect(past.savingsRatePct).toBeNull();
    expect(past.notable).toEqual([]);
    expect(past.note).toMatchObject({ month: '2025-11', body: null, updatedAt: null });
  });

  it('answers 404 to a non-member and 401 without a session; the other pool never leaks', async () => {
    await seed();
    await seed(s.poolB);
    await world.notes.putMonthNote(await s.as('outsider'), s.poolB, '2026-03', {
      body: 'Nota do mês Beta Secreta',
      expectedUpdatedAt: null,
    });
    await expect(review('outsider', '2026-03', s.poolA)).rejects.toBeInstanceOf(NotFoundError);
    await expect(world.months.review(new Headers(), s.poolA, '2026-03')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    const a = JSON.stringify(await review('owner', '2026-03', s.poolA));
    expect(a).not.toContain('Beta Secreta');
  });

  it('treats a bad month, including an injection payload, as invalid input (400)', async () => {
    for (const bad of ["2026-03' OR 1=1 --", '2026-13', '2026-3', '', '2026-03-01']) {
      await expect(review('owner', bad)).rejects.toBeInstanceOf(ValidationError);
    }
  });
});
