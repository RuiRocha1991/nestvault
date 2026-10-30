import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ConflictError,
  CostDto,
  CostListDto,
  CostPaymentDto,
  CostTotalsDto,
  createEntitlements,
  createPropertyCostsService,
  ForbiddenError,
  logger,
  NotFoundError,
  PlanLimitError,
  UnauthorizedError,
  UpcomingCostsDto,
  ValidationError,
  type PropertyCostsService,
} from '@nestvault/services';

import { createApiWorld, type ApiWorld, type Persona, type Scenario } from '../support/api-world';
import { rows } from '../support/auth-harness';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let world: ApiWorld;
let s: Scenario;
// The world's service has billing off (every pool is Pro); this one has it on: a pool without a
// subscription is Free.
let billed: PropertyCostsService;

beforeAll(async () => {
  logger.level = 'silent';
  world = await createApiWorld();
  billed = createPropertyCostsService({
    auth: world.auth,
    identity: world.identity,
    entitlements: createEntitlements({ identity: world.identity, billingEnabled: true }),
    run: world.database.withPool,
    trustedProxyHops: 1,
  });
});

beforeEach(async () => {
  s = await world.newScenario();
});

afterAll(async () => {
  await world.close();
});

// The test clock starts on 2026-01-01.
const ownerOf = (poolId: string): Persona => (poolId === s.poolA ? 'owner' : 'outsider');
const anyId = '0192f2c8-7a1e-7000-8000-000000000001';

const makeProperty = async (poolId = s.poolA) => {
  const headers = await s.as(ownerOf(poolId));
  const [holder] = (await world.holders.list(headers, poolId)).holders;
  return world.properties.create(headers, poolId, {
    name: 'Casa',
    type: 'primary_home',
    purchaseDate: '2020-09-01',
    purchasePrice: '124000',
    holders: [{ holderId: holder?.id ?? '', sharePct: '100' }],
  });
};

const create = async (
  as: Persona = 'owner',
  patch: object = {},
  poolId = s.poolA,
  propertyId?: string,
) =>
  world.propertyCosts.create(await s.as(as), poolId, {
    propertyId: propertyId ?? (await makeProperty(poolId)).id,
    kind: 'imi',
    amount: '412.5',
    periodicity: 'annual',
    startDate: '2024-04-30',
    ...patch,
  });

/** A debit of the pool, to pay an occurrence with. */
const makeDebit = async (amount = '-412.5', poolId = s.poolA) => {
  const headers = await s.as(ownerOf(poolId));
  const [holder] = (await world.holders.list(headers, poolId)).holders;
  const account = await world.accounts.create(headers, poolId, {
    type: 'checking',
    name: 'Conta à ordem',
    currency: 'EUR',
    holderIds: [holder?.id ?? ''],
  });
  return world.transactions.create(headers, poolId, {
    accountId: account.id,
    date: '2026-04-30',
    description: 'IMI 2026',
    amount,
  });
};
const subscribe = (plan: string) =>
  world.identity.db.execute(
    sql`insert into pool_subscriptions (pool_id, plan, status) values (${s.poolA}, ${plan}, 'active')`,
  );

describe('property costs service', () => {
  it('adds a cost with its annual amount and next due date', async () => {
    const created = await create();
    expect(CostDto.parse(created)).toEqual(created);
    expect(created).toMatchObject({
      kind: 'imi',
      amount: '412.5000',
      periodicity: 'annual',
      intervalMonths: 12,
      annualAmount: '412.5',
      // The clock is on 2026-01-01.
      nextDueDate: '2026-04-30',
      endDate: null,
      name: null,
    });
    const monthly = await create('owner', {
      kind: 'condominium',
      amount: '35',
      periodicity: 'monthly',
      startDate: '2026-01-31',
    });
    expect(monthly).toMatchObject({
      intervalMonths: 1,
      annualAmount: '420',
      nextDueDate: '2026-01-31',
    });
    const custom = await create('owner', {
      kind: 'other',
      name: 'Dedetização',
      amount: '60',
      periodicity: 'custom',
      intervalMonths: 6,
      startDate: '2025-11-10',
    });
    expect(custom).toMatchObject({
      intervalMonths: 6,
      annualAmount: '120',
      nextDueDate: '2026-05-10',
    });
  });

  it('lets owner and admin write; refuses member and viewer (403); everybody reads', async () => {
    const property = await makeProperty();
    for (const as of ['owner', 'admin'] as const) await create(as, {}, s.poolA, property.id);
    for (const as of ['member', 'viewer'] as const) {
      await expect(create(as, {}, s.poolA, property.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
    for (const as of ['owner', 'admin', 'member', 'viewer'] as const) {
      const list = await world.propertyCosts.list(await s.as(as), s.poolA);
      expect(CostListDto.parse(list)).toEqual(list);
      expect(list.costs).toHaveLength(2);
    }
  });

  it('answers 401 without a session and 404 to a non-member', async () => {
    await expect(world.propertyCosts.list(new Headers(), s.poolA)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(world.propertyCosts.list(await s.as('outsider'), s.poolA)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      world.propertyCosts.create(await s.as('outsider'), s.poolA, {
        propertyId: anyId,
        kind: 'imi',
        amount: '1',
        periodicity: 'annual',
        startDate: '2026-01-01',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses what is not valid (400) and extra fields such as poolId', async () => {
    const property = await makeProperty();
    const bad = (patch: object) => create('owner', patch, s.poolA, property.id);
    await expect(bad({ kind: 'rent' })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ amount: '0' })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ amount: '1,5' })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ amount: 12 })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ startDate: '2026-02-30' })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ periodicity: 'weekly' })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ poolId: s.poolB })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ id: anyId })).rejects.toBeInstanceOf(ValidationError);
    // Cross-field rules.
    await expect(bad({ endDate: '2024-04-29' })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ kind: 'other' })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ periodicity: 'custom' })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ periodicity: 'custom', intervalMonths: 61 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(bad({ intervalMonths: 3 })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ name: 'a\u0000b', kind: 'other' })).rejects.toBeInstanceOf(ValidationError);
    expect((await world.propertyCosts.list(await s.as('owner'), s.poolA)).costs).toEqual([]);
  });

  it('refuses a property or an account of another pool (400) and writes nothing', async () => {
    const foreign = await makeProperty(s.poolB);
    await expect(create('owner', {}, s.poolA, foreign.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(create('owner', { accountId: anyId })).rejects.toBeInstanceOf(ValidationError);
    expect((await world.propertyCosts.list(await s.as('owner'), s.poolA)).costs).toEqual([]);
  });

  it('changes only what is sent, recomputes the interval and keeps the property', async () => {
    const created = await create();
    const owner = await s.as('owner');
    const renamed = await world.propertyCosts.update(owner, s.poolA, created.id, { amount: '420' });
    expect(renamed).toMatchObject({
      amount: '420.0000',
      intervalMonths: 12,
      propertyId: created.propertyId,
    });
    const monthly = await world.propertyCosts.update(owner, s.poolA, created.id, {
      periodicity: 'monthly',
    });
    expect(monthly).toMatchObject({
      periodicity: 'monthly',
      intervalMonths: 1,
      annualAmount: '5040',
    });
    const ended = await world.propertyCosts.update(owner, s.poolA, created.id, {
      endDate: '2026-02-28',
    });
    expect(ended.endDate).toBe('2026-02-28');
    await expect(
      world.propertyCosts.update(owner, s.poolA, created.id, { propertyId: anyId }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      world.propertyCosts.update(owner, s.poolA, created.id, { endDate: '2020-01-01' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      world.propertyCosts.update(owner, s.poolA, created.id, { intervalMonths: 3 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      world.propertyCosts.update(owner, s.poolA, created.id, { kind: 'other' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      world.propertyCosts.update(await s.as('member'), s.poolA, created.id, { amount: '1' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('keeps a name exactly as written, and a hostile string is data', async () => {
    const payload = `'; DROP TABLE property_costs; -- <b>x</b>`;
    const created = await create('owner', { kind: 'other', name: payload });
    expect(created.name).toBe(payload);
    const list = await world.propertyCosts.list(await s.as('owner'), s.poolA);
    expect(list.costs[0]?.name).toBe(payload);
  });

  it('deletes a cost and answers 404 afterwards', async () => {
    const created = await create();
    const owner = await s.as('owner');
    await world.propertyCosts.remove(owner, s.poolA, created.id);
    await expect(world.propertyCosts.get(owner, s.poolA, created.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(world.propertyCosts.remove(owner, s.poolA, created.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(world.propertyCosts.get(owner, s.poolA, 'not-a-uuid')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('does not show or touch the costs of another pool (404)', async () => {
    const other = await create('outsider', {}, s.poolB);
    const owner = await s.as('owner');
    await expect(world.propertyCosts.get(owner, s.poolA, other.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      world.propertyCosts.update(owner, s.poolA, other.id, { amount: '1' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(world.propertyCosts.remove(owner, s.poolA, other.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      world.propertyCosts.linkPayment(owner, s.poolA, other.id, other.startDate, {
        transactionId: anyId,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await world.propertyCosts.list(owner, s.poolA)).costs).toEqual([]);
    // And pool B's own cost is untouched.
    expect(await world.propertyCosts.get(await s.as('outsider'), s.poolB, other.id)).toEqual(other);
  });

  it('filters by property and refuses a malformed filter', async () => {
    const house = await makeProperty();
    const flat = await makeProperty();
    await create('owner', {}, s.poolA, house.id);
    await create('owner', { amount: '30' }, s.poolA, flat.id);
    const owner = await s.as('owner');
    expect((await world.propertyCosts.list(owner, s.poolA, flat.id)).costs).toHaveLength(1);
    expect((await world.propertyCosts.list(owner, s.poolA)).costs).toHaveLength(2);
    await expect(world.propertyCosts.list(owner, s.poolA, `' OR 1=1 --`)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('the month forecast', () => {
  it('puts an annual cost in the right month, oldest first, and a monthly one in every month', async () => {
    const property = await makeProperty();
    await create('owner', {}, s.poolA, property.id);
    await create(
      'owner',
      { kind: 'insurance_home', amount: '150', startDate: '2021-03-15' },
      s.poolA,
      property.id,
    );
    await create(
      'owner',
      { kind: 'condominium', amount: '35', periodicity: 'monthly', startDate: '2026-01-31' },
      s.poolA,
      property.id,
    );
    const owner = await s.as('owner');
    const upcoming = await world.propertyCosts.upcoming(owner, s.poolA);
    expect(UpcomingCostsDto.parse(upcoming)).toEqual(upcoming);
    expect(upcoming.months.map((month) => month.month)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    const amount = (month: string) =>
      upcoming.months.find((entry) => entry.month === month)?.amount;
    expect(amount('2026-01')).toBe('35');
    expect(amount('2026-03')).toBe('185');
    expect(amount('2026-04')).toBe('447.5');
    const march = upcoming.months.find((entry) => entry.month === '2026-03');
    expect(march?.occurrences.map((row) => [row.kind, row.dueDate]).sort()).toEqual([
      ['condominium', '2026-03-31'],
      ['insurance_home', '2026-03-15'],
    ]);
  });

  it('honours the window and refuses a bad one', async () => {
    await create();
    const owner = await s.as('owner');
    expect((await world.propertyCosts.upcoming(owner, s.poolA, { months: '3' })).months).toEqual(
      [],
    );
    expect(
      (await world.propertyCosts.upcoming(owner, s.poolA, { months: '4' })).months.map(
        (month) => month.month,
      ),
    ).toEqual(['2026-04']);
    for (const months of ['0', '25', 'x', '1.5']) {
      await expect(world.propertyCosts.upcoming(owner, s.poolA, { months })).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    await expect(
      world.propertyCosts.upcoming(owner, s.poolA, { months: '3', pool: 'x' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('leaves out an occurrence once a bank debit paid it, and brings it back when unlinked', async () => {
    const created = await create();
    const owner = await s.as('owner');
    const movement = await makeDebit();
    const linked = await world.propertyCosts.linkPayment(owner, s.poolA, created.id, '2026-04-30', {
      transactionId: movement.id,
    });
    expect(CostPaymentDto.parse(linked)).toEqual(linked);
    expect(linked).toEqual({
      costId: created.id,
      dueDate: '2026-04-30',
      transactionId: movement.id,
    });
    expect((await world.propertyCosts.upcoming(owner, s.poolA)).months).toEqual([]);
    await world.propertyCosts.unlinkPayment(owner, s.poolA, created.id, '2026-04-30');
    expect((await world.propertyCosts.upcoming(owner, s.poolA)).months).toHaveLength(1);
  });
});

describe('no double counting between installment insurances and property costs', () => {
  const makeLoan = async (propertyId: string, patch: object = {}) =>
    world.loans.create(await s.as('owner'), s.poolA, {
      name: 'Crédito habitação',
      kind: 'mortgage',
      propertyId,
      principal: '111600',
      startDate: '2020-09-01',
      firstDueDate: '2020-10-05',
      termMonths: 480,
      rateType: 'fixed',
      annualRate: '1.5',
      paymentDay: 5,
      ...patch,
    });
  const addInstallment = async (loanId: string, number: number, dueDate: string, body: object) =>
    world.loans.addInstallment(await s.as('owner'), s.poolA, loanId, {
      number,
      dueDate,
      capital: '300',
      interest: '140',
      ...body,
    });

  it('counts the home insurance once when it moves from an annual payment into the installment', async () => {
    const property = await makeProperty();
    // Annual until 2023, then monthly inside the installment (the reference).
    const policy = await create(
      'owner',
      { kind: 'insurance_home', amount: '150', startDate: '2022-03-15' },
      s.poolA,
      property.id,
    );
    const loan = await makeLoan(property.id);
    for (let month = 1; month <= 12; month += 1) {
      const dueDate = `2026-${String(month).padStart(2, '0')}-05`;
      await addInstallment(loan.id, month, dueDate, { homeInsurance: '16.5' });
    }
    const owner = await s.as('owner');
    const totals = await world.propertyCosts.totals(owner, s.poolA, {
      propertyId: property.id,
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(CostTotalsDto.parse(totals)).toEqual(totals);
    // The 15 March payment falls in a month whose installment carries the insurance: covered.
    expect(totals.occurrences.map((row) => [row.dueDate, row.status])).toEqual([
      ['2026-03-15', 'covered'],
    ]);
    expect(totals.costs).toBe('0');
    expect(totals.installmentInsurance).toBe('198');
    expect(totals.total).toBe('198');
    // The forecast does not repeat it either.
    expect((await world.propertyCosts.upcoming(owner, s.poolA)).months).toEqual([]);
    // Ending the old policy (the owner's fix) leaves the totals as they are.
    await world.propertyCosts.update(owner, s.poolA, policy.id, { endDate: '2023-12-31' });
    expect(
      (await world.propertyCosts.totals(owner, s.poolA, { from: '2026-01-01', to: '2026-12-31' }))
        .total,
    ).toBe('198');
    // 2022 and 2023 still show the annual payment, with no installment insurance yet.
    const before = await world.propertyCosts.totals(owner, s.poolA, {
      propertyId: property.id,
      from: '2022-01-01',
      to: '2023-12-31',
    });
    expect(before).toMatchObject({ costs: '300', installmentInsurance: '0', total: '300' });
  });

  it('counts the insurance of an installment only when its field is enabled, and per property', async () => {
    const house = await makeProperty();
    const flat = await makeProperty();
    const loan = await makeLoan(house.id);
    await addInstallment(loan.id, 1, '2026-01-05', {
      homeInsurance: '16.5',
      lifeInsurance: '12.34',
      creditInsurance: '5',
    });
    const owner = await s.as('owner');
    // Credit insurance is not enabled by default: 16.5 + 12.34.
    const mine = await world.propertyCosts.totals(owner, s.poolA, { propertyId: house.id });
    expect(mine.installmentInsurance).toBe('28.84');
    // The other property's totals and the pool-wide ones.
    expect(
      (await world.propertyCosts.totals(owner, s.poolA, { propertyId: flat.id }))
        .installmentInsurance,
    ).toBe('0');
    expect((await world.propertyCosts.totals(owner, s.poolA)).installmentInsurance).toBe('28.84');
    // A policy of the other property is not covered by this installment.
    await create(
      'owner',
      { kind: 'insurance_home', amount: '150', startDate: '2026-01-20' },
      s.poolA,
      flat.id,
    );
    const both = await world.propertyCosts.totals(owner, s.poolA);
    expect(both).toMatchObject({ costs: '150', installmentInsurance: '28.84', total: '178.84' });
  });
});

describe('totals', () => {
  it('adds the paid and the expected by kind and defaults to the current year', async () => {
    const property = await makeProperty();
    await create('owner', {}, s.poolA, property.id);
    await create(
      'owner',
      { kind: 'condominium', amount: '35', periodicity: 'monthly', startDate: '2026-01-31' },
      s.poolA,
      property.id,
    );
    const owner = await s.as('owner');
    const imi = (await world.propertyCosts.list(owner, s.poolA)).costs.find(
      (cost) => cost.kind === 'imi',
    );
    await world.propertyCosts.linkPayment(owner, s.poolA, imi?.id ?? '', '2026-04-30', {
      transactionId: (await makeDebit()).id,
    });
    const totals = await world.propertyCosts.totals(owner, s.poolA);
    expect(totals).toMatchObject({
      propertyId: null,
      from: '2026-01-01',
      to: '2026-12-31',
      paid: '412.5',
      expected: '420',
      costs: '832.5',
      installmentInsurance: '0',
      total: '832.5',
      byKind: { imi: '412.5', condominium: '420', insurance_home: '0' },
    });
    expect(totals.occurrences).toHaveLength(13);
  });

  it('refuses an upside-down period, one over five years and unknown filters', async () => {
    const owner = await s.as('owner');
    const totals = (query: object) => world.propertyCosts.totals(owner, s.poolA, query);
    await expect(totals({ from: '2026-02-01', to: '2026-01-01' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(totals({ from: '2020-01-01', to: '2026-01-01' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(totals({ from: '2026-13-01' })).rejects.toBeInstanceOf(ValidationError);
    await expect(totals({ propertyId: 'x' })).rejects.toBeInstanceOf(ValidationError);
    await expect(totals({ poolId: s.poolB })).rejects.toBeInstanceOf(ValidationError);
    expect((await totals({ from: '2021-01-01', to: '2026-01-01' })).total).toBe('0');
  });

  it('does not count the costs of another pool', async () => {
    await create('outsider', { amount: '987654' }, s.poolB);
    const totals = await world.propertyCosts.totals(await s.as('owner'), s.poolA);
    expect(totals).toMatchObject({ total: '0', occurrences: [] });
    expect(JSON.stringify(totals)).not.toContain('987654');
  });
});

describe('paying an occurrence with a bank debit', () => {
  const setup = async () => {
    const created = await create();
    return { created, movement: await makeDebit() };
  };

  it('refuses a second link (409) and a movement already used (409)', async () => {
    const { created, movement } = await setup();
    const owner = await s.as('owner');
    const link = (date: string, id = movement.id) =>
      world.propertyCosts.linkPayment(owner, s.poolA, created.id, date, { transactionId: id });
    await link('2026-04-30');
    await expect(link('2026-04-30')).rejects.toBeInstanceOf(ConflictError);
    await expect(link('2027-04-30')).rejects.toBeInstanceOf(ConflictError);
    const second = await makeDebit();
    await expect(link('2026-04-30', second.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses a date that is not a due date, a credit, a movement of another pool and an unknown one (400)', async () => {
    const { created, movement } = await setup();
    const owner = await s.as('owner');
    const link = (date: string, id: string) =>
      world.propertyCosts.linkPayment(owner, s.poolA, created.id, date, { transactionId: id });
    await expect(link('2026-05-01', movement.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(link('2023-04-30', movement.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(link('not-a-date', movement.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(link('2026-04-30', anyId)).rejects.toBeInstanceOf(ValidationError);
    const credit = await makeDebit('412.5');
    await expect(link('2026-04-30', credit.id)).rejects.toBeInstanceOf(ValidationError);
    const foreign = await makeDebit('-412.5', s.poolB);
    await expect(link('2026-04-30', foreign.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(
      world.propertyCosts.linkPayment(owner, s.poolA, created.id, '2026-04-30', {
        transactionId: movement.id,
        poolId: s.poolB,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses a due date after the cost has ended', async () => {
    const { created, movement } = await setup();
    await world.propertyCosts.update(await s.as('owner'), s.poolA, created.id, {
      endDate: '2025-12-31',
    });
    await expect(
      world.propertyCosts.linkPayment(await s.as('owner'), s.poolA, created.id, '2026-04-30', {
        transactionId: movement.id,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('unlinks, answers 404 when there is nothing to unlink', async () => {
    const { created } = await setup();
    const owner = await s.as('owner');
    await expect(
      world.propertyCosts.unlinkPayment(owner, s.poolA, created.id, '2026-04-30'),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.propertyCosts.unlinkPayment(owner, s.poolA, created.id, 'x'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('only owner and admin link and unlink (403)', async () => {
    const { created, movement } = await setup();
    for (const as of ['member', 'viewer'] as const) {
      const headers = await s.as(as);
      await expect(
        world.propertyCosts.linkPayment(headers, s.poolA, created.id, '2026-04-30', {
          transactionId: movement.id,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        world.propertyCosts.unlinkPayment(headers, s.poolA, created.id, '2026-04-30'),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('deleting the movement makes the occurrence expected again', async () => {
    const { created, movement } = await setup();
    const owner = await s.as('owner');
    await world.propertyCosts.linkPayment(owner, s.poolA, created.id, '2026-04-30', {
      transactionId: movement.id,
    });
    expect((await world.propertyCosts.upcoming(owner, s.poolA)).months).toEqual([]);
    await world.transactions.remove(owner, s.poolA, movement.id);
    expect((await world.propertyCosts.upcoming(owner, s.poolA)).months).toHaveLength(1);
  });
});

describe('plan: property costs are Pro', () => {
  const refused = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(PlanLimitError);
    expect(error).toMatchObject({ status: 403, code: 'plan_limit', resource: 'real_estate' });
  };

  it('answers plan_limit on a Free pool for every operation, reads included', async () => {
    const owner = await s.as('owner');
    await refused(billed.list(owner, s.poolA));
    await refused(billed.get(owner, s.poolA, anyId));
    await refused(
      billed.create(owner, s.poolA, {
        propertyId: anyId,
        kind: 'imi',
        amount: '1',
        periodicity: 'annual',
        startDate: '2026-01-01',
      }),
    );
    await refused(billed.update(owner, s.poolA, anyId, { amount: '2' }));
    await refused(billed.remove(owner, s.poolA, anyId));
    await refused(billed.upcoming(owner, s.poolA));
    await refused(billed.totals(owner, s.poolA));
    await refused(
      billed.linkPayment(owner, s.poolA, anyId, '2026-01-01', { transactionId: anyId }),
    );
    await refused(billed.unlinkPayment(owner, s.poolA, anyId, '2026-01-01'));
    await refused(billed.list(await s.as('viewer'), s.poolA));
    expect(await world.propertyCosts.list(owner, s.poolA)).toEqual({ costs: [] });
  });

  it('asks the role first: a viewer who writes gets 403 forbidden, not plan_limit', async () => {
    await expect(billed.remove(await s.as('viewer'), s.poolA, anyId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('works on a Pro pool with billing on', async () => {
    await subscribe('pro');
    const property = await makeProperty();
    const created = await billed.create(await s.as('owner'), s.poolA, {
      propertyId: property.id,
      kind: 'imi',
      amount: '100',
      periodicity: 'annual',
      startDate: '2026-04-30',
    });
    expect(created.amount).toBe('100.0000');
    expect((await billed.list(await s.as('member'), s.poolA)).costs).toHaveLength(1);
  });
});

describe('what costs block', () => {
  it('a property with costs cannot be deleted (409) until the costs are gone', async () => {
    const created = await create();
    const owner = await s.as('owner');
    await expect(
      world.properties.remove(owner, s.poolA, created.propertyId),
    ).rejects.toBeInstanceOf(ConflictError);
    await world.propertyCosts.remove(owner, s.poolA, created.id);
    await world.properties.remove(owner, s.poolA, created.propertyId);
  });
});

describe('audit', () => {
  it('records the changes without amounts or names', async () => {
    const created = await create('owner', {
      kind: 'other',
      name: 'Jardineiro Secreto',
      amount: '987654',
    });
    const owner = await s.as('owner');
    const movement = await makeDebit('-987654');
    await world.propertyCosts.update(owner, s.poolA, created.id, { amount: '555444' });
    await world.propertyCosts.linkPayment(owner, s.poolA, created.id, '2024-04-30', {
      transactionId: movement.id,
    });
    await world.propertyCosts.unlinkPayment(owner, s.poolA, created.id, '2024-04-30');
    await world.propertyCosts.remove(owner, s.poolA, created.id);
    const log = await rows<{ action: string; entry: string }>(
      world.identity,
      sql`select action, to_jsonb(audit_log)::text as entry from audit_log where action like 'cost.%' and target = ${created.id} order by at`,
    );
    expect(log.map((entry) => entry.action)).toEqual([
      'cost.created',
      'cost.updated',
      'cost.payment_linked',
      'cost.payment_unlinked',
      'cost.deleted',
    ]);
    const text = JSON.stringify(log);
    for (const secret of ['987654', '555444', 'Jardineiro Secreto']) {
      expect(text).not.toContain(secret);
    }
  });
});
