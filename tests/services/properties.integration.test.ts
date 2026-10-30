import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ConflictError,
  createEntitlements,
  createPropertiesService,
  ForbiddenError,
  logger,
  NotFoundError,
  PlanLimitError,
  PropertyDto,
  PropertyListDto,
  UnauthorizedError,
  ValidationError,
  ValuationDto,
  type PropertiesService,
} from '@nestvault/services';

import { createApiWorld, type ApiWorld, type Persona, type Scenario } from '../support/api-world';
import { rows } from '../support/auth-harness';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let world: ApiWorld;
let s: Scenario;
// The world's service has billing off (every pool is Pro); this one has it on: a pool without a
// subscription is Free.
let billed: PropertiesService;

beforeAll(async () => {
  logger.level = 'silent';
  world = await createApiWorld();
  billed = createPropertiesService({
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

const ownerOf = (poolId: string): Persona => (poolId === s.poolA ? 'owner' : 'outsider');
const people = async (poolId = s.poolA) =>
  (await world.holders.list(await s.as(ownerOf(poolId)), poolId)).holders.map(
    (holder) => holder.id,
  );

// The reference property of the owner's spreadsheet (PRD "Real estate and loans").
const reference = async (patch: object = {}, poolId = s.poolA) => ({
  name: 'Apartamento',
  type: 'primary_home',
  address: 'Rua das Flores 1',
  purchaseDate: '2020-09-01',
  purchasePrice: '124000',
  downPayment: '12400',
  costs: { deed: '915', imt: '631.86', stampDuty: '992', bankFees: '20.85' },
  sellingCostPct: '5',
  holders: [{ holderId: (await people(poolId))[0] ?? '', sharePct: '100' }],
  ...patch,
});
const property = async (as: Persona = 'owner', patch: object = {}, poolId = s.poolA) =>
  world.properties.create(await s.as(as), poolId, await reference(patch, poolId));
const valuation = async (propertyId: string, body: object, poolId = s.poolA) =>
  world.properties.addValuation(await s.as(ownerOf(poolId)), poolId, propertyId, body);
const subscribe = (plan: string) =>
  world.identity.db.execute(
    sql`insert into pool_subscriptions (pool_id, plan, status) values (${s.poolA}, ${plan}, 'active')`,
  );

describe('properties service', () => {
  it('registers the reference property: costs 2 559,71 €, loan 111 600 €', async () => {
    const created = await property();
    expect(PropertyDto.parse(created)).toEqual(created);
    expect(created).toMatchObject({
      name: 'Apartamento',
      type: 'primary_home',
      purchasePrice: '124000.0000',
      downPayment: '12400.0000',
      costs: { deed: '915.0000', registration: '0.0000', total: '2559.71' },
      loanAmount: '111600',
      sellingCostPct: '5.000000',
      includeInNetWorth: true,
      latestValuation: null,
    });
    expect(created.holders).toHaveLength(1);
  });

  it('lets owner and admin write; refuses member and viewer (403); everybody reads', async () => {
    for (const as of ['owner', 'admin'] as const) await property(as);
    for (const as of ['member', 'viewer'] as const) {
      await expect(property(as)).rejects.toBeInstanceOf(ForbiddenError);
    }
    for (const as of ['owner', 'admin', 'member', 'viewer'] as const) {
      const list = await world.properties.list(await s.as(as), s.poolA);
      expect(PropertyListDto.parse(list)).toEqual(list);
      expect(list.properties).toHaveLength(2);
    }
  });

  it('answers 401 without a session and 404 to a non-member', async () => {
    await expect(world.properties.list(new Headers(), s.poolA)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(world.properties.list(await s.as('outsider'), s.poolA)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      world.properties.create(await s.as('outsider'), s.poolA, await reference()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('splits ownership between people when the shares add up to 100', async () => {
    const [first, second] = await people();
    const created = await property('owner', {
      holders: [
        { holderId: first, sharePct: '60.5' },
        { holderId: second, sharePct: '39.5' },
      ],
    });
    expect(created.holders.map((holder) => holder.sharePct).sort()).toEqual([
      '39.500000',
      '60.500000',
    ]);
  });

  it.each([
    [
      'shares below 100',
      [
        ['a', '60'],
        ['b', '30'],
      ],
    ],
    [
      'shares above 100',
      [
        ['a', '60'],
        ['b', '60'],
      ],
    ],
    [
      'a share of zero',
      [
        ['a', '0'],
        ['b', '100'],
      ],
    ],
    ['a share above 100', [['a', '100.1']]],
    [
      'the same person twice',
      [
        ['a', '50'],
        ['a', '50'],
      ],
    ],
    ['no owner at all', []],
  ])('refuses %s (400)', async (_name, shares) => {
    const [a, b] = await people();
    const pick = (key: string) => (key === 'a' ? a : b);
    await expect(
      property('owner', {
        holders: shares.map(([key, sharePct]) => ({ holderId: pick(key ?? ''), sharePct })),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await world.properties.list(await s.as('owner'), s.poolA)).toEqual({ properties: [] });
  });

  it('refuses an owner who is not a person of this pool (400)', async () => {
    const [foreign] = await people(s.poolB);
    await expect(
      property('owner', { holders: [{ holderId: foreign ?? '', sharePct: '100' }] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses a down payment above the price, also through an update', async () => {
    await expect(property('owner', { downPayment: '124000.01' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const created = await property();
    await expect(
      world.properties.update(await s.as('owner'), s.poolA, created.id, { purchasePrice: '10000' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(
      (await world.properties.get(await s.as('owner'), s.poolA, created.id)).purchasePrice,
    ).toBe('124000.0000');
  });

  it.each([
    ['poolId', { poolId: '0192f2c8-7a1e-7000-8000-000000000001' }],
    ['id', { id: '0192f2c8-7a1e-7000-8000-000000000001' }],
    ['an unknown field', { owner: 'me' }],
    ['a cost item that does not exist', { costs: { notary: '10' } }],
    ['a negative price', { purchasePrice: '-5' }],
    ['a float price written as a number', { purchasePrice: 124000 }],
    ['an unknown type', { type: 'castle' }],
    ['a control character in the name', { name: 'Casa\u0000' }],
  ])('refuses %s in the body (400)', async (_name, extra) => {
    await expect(property('owner', extra)).rejects.toBeInstanceOf(ValidationError);
  });

  it('changes only what the body says and replaces the owners when asked', async () => {
    const created = await property();
    const [, second] = await people();
    const updated = await world.properties.update(await s.as('owner'), s.poolA, created.id, {
      name: 'Casa',
      address: null,
      costs: { registration: '100' },
      holders: [{ holderId: second ?? '', sharePct: '100' }],
    });
    expect(updated).toMatchObject({
      name: 'Casa',
      address: null,
      purchasePrice: '124000.0000',
      // The other items stay: 2 559,71 + 100.
      costs: { deed: '915.0000', registration: '100.0000', total: '2659.71' },
    });
    expect(updated.holders).toEqual([{ holderId: second, sharePct: '100.000000' }]);
  });

  it('answers 404 for another pool’s property and for a malformed id', async () => {
    const other = await property('outsider', {}, s.poolB);
    const owner = await s.as('owner');
    await expect(world.properties.get(owner, s.poolA, other.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      world.properties.update(owner, s.poolA, other.id, { name: 'hijack' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(world.properties.remove(owner, s.poolA, other.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(world.properties.listValuations(owner, s.poolA, other.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      world.properties.addValuation(owner, s.poolA, other.id, { date: '2025-01-01', value: '1' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(world.properties.get(owner, s.poolA, `' OR 1=1 --`)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await world.properties.get(await s.as('outsider'), s.poolB, other.id)).name).toBe(
      'Apartamento',
    );
  });

  it('deletes a property with its owners and valuations', async () => {
    const created = await property();
    await valuation(created.id, { date: '2025-01-01', value: '150000' });
    await world.properties.remove(await s.as('owner'), s.poolA, created.id);
    await expect(
      world.properties.get(await s.as('owner'), s.poolA, created.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.properties.remove(await s.as('owner'), s.poolA, created.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('valuations', () => {
  it('uses the newest date as the latest valuation, whatever the order of entry', async () => {
    const created = await property();
    await valuation(created.id, { date: '2024-03-01', value: '140000', source: 'estimate' });
    const newest = await valuation(created.id, {
      date: '2025-06-30',
      value: '150000',
      source: 'bank_appraisal',
    });
    await valuation(created.id, { date: '2023-01-01', value: '130000' });
    expect(ValuationDto.parse(newest)).toEqual(newest);
    const seen = await world.properties.get(await s.as('viewer'), s.poolA, created.id);
    expect(seen.latestValuation).toEqual(newest);
    const list = await world.properties.listValuations(await s.as('viewer'), s.poolA, created.id);
    expect(list.valuations.map((v) => v.date)).toEqual(['2025-06-30', '2024-03-01', '2023-01-01']);
  });

  it('refuses a second valuation of the same day (409) and deletes one', async () => {
    const created = await property();
    const first = await valuation(created.id, { date: '2025-01-01', value: '150000' });
    await expect(
      valuation(created.id, { date: '2025-01-01', value: '160000' }),
    ).rejects.toBeInstanceOf(ConflictError);
    await world.properties.removeValuation(await s.as('owner'), s.poolA, created.id, first.id);
    expect(
      (await world.properties.get(await s.as('owner'), s.poolA, created.id)).latestValuation,
    ).toBeNull();
    await expect(
      world.properties.removeValuation(await s.as('owner'), s.poolA, created.id, first.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses bad valuations (400) and writes by member or viewer (403)', async () => {
    const created = await property();
    for (const body of [
      { date: '2025-13-01', value: '1' },
      { date: '2025-01-01', value: '0' },
      { date: '2025-01-01', value: '1', source: 'rumour' },
      { date: '2025-01-01', value: '1', propertyId: created.id },
    ]) {
      await expect(valuation(created.id, body)).rejects.toBeInstanceOf(ValidationError);
    }
    for (const as of ['member', 'viewer'] as const) {
      await expect(
        world.properties.addValuation(await s.as(as), s.poolA, created.id, {
          date: '2025-01-01',
          value: '1',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('cannot delete a valuation through another property’s URL', async () => {
    const one = await property();
    const two = await property('owner', { name: 'Garagem' });
    const mine = await valuation(one.id, { date: '2025-01-01', value: '150000' });
    await expect(
      world.properties.removeValuation(await s.as('owner'), s.poolA, two.id, mine.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(
      (await world.properties.listValuations(await s.as('owner'), s.poolA, one.id)).valuations,
    ).toHaveLength(1);
  });
});

describe('plan: real estate is Pro', () => {
  const refused = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(PlanLimitError);
    expect(error).toMatchObject({
      status: 403,
      code: 'plan_limit',
      resource: 'real_estate',
      limit: null,
    });
  };

  it('answers plan_limit on a Free pool for every operation, reads included', async () => {
    const owner = await s.as('owner');
    await refused(billed.list(owner, s.poolA));
    await refused(billed.get(owner, s.poolA, '0192f2c8-7a1e-7000-8000-000000000001'));
    await refused(billed.create(owner, s.poolA, await reference()));
    await refused(
      billed.addValuation(owner, s.poolA, '0192f2c8-7a1e-7000-8000-000000000001', {
        date: '2025-01-01',
        value: '1',
      }),
    );
    await refused(billed.list(await s.as('viewer'), s.poolA));
    expect(await world.properties.list(owner, s.poolA)).toEqual({ properties: [] });
  });

  it('asks the role first: a viewer who writes gets 403 forbidden, not plan_limit', async () => {
    await expect(
      billed.create(await s.as('viewer'), s.poolA, await reference()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('works on a Pro pool with billing on', async () => {
    await subscribe('pro');
    const created = await billed.create(await s.as('owner'), s.poolA, await reference());
    expect(created.costs.total).toBe('2559.71');
    expect((await billed.list(await s.as('member'), s.poolA)).properties).toHaveLength(1);
  });

  it('keeps the data of a pool that went back to Free, only blocked (downgrade never deletes)', async () => {
    await subscribe('pro');
    const created = await billed.create(await s.as('owner'), s.poolA, await reference());
    await world.identity.db.execute(sql`update pool_subscriptions set status = 'canceled'`);
    await refused(billed.get(await s.as('owner'), s.poolA, created.id));
    expect((await world.properties.get(await s.as('owner'), s.poolA, created.id)).name).toBe(
      'Apartamento',
    );
  });
});

describe('people who own a property', () => {
  it('cannot be removed while they own part of one (409)', async () => {
    const manual = await world.holders.create(await s.as('owner'), s.poolA, { name: 'Simão' });
    await property('owner', { holders: [{ holderId: manual.id, sharePct: '100' }] });
    await expect(
      world.holders.remove(await s.as('owner'), s.poolA, manual.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('audit', () => {
  it('records the changes without amounts', async () => {
    const created = await property('owner', { purchasePrice: '987654' });
    const added = await valuation(created.id, { date: '2025-01-01', value: '555444' });
    await world.properties.update(await s.as('owner'), s.poolA, created.id, { name: 'Novo' });
    await world.properties.removeValuation(await s.as('owner'), s.poolA, created.id, added.id);
    await world.properties.remove(await s.as('owner'), s.poolA, created.id);
    const log = await rows<{ action: string; entry: string }>(
      world.identity,
      sql`select action, to_jsonb(audit_log)::text as entry from audit_log where action like 'property.%' and target = ${created.id} order by at`,
    );
    expect(log.map((row) => row.action)).toEqual([
      'property.created',
      'property.valuation_added',
      'property.updated',
      'property.valuation_deleted',
      'property.deleted',
    ]);
    const text = JSON.stringify(log);
    expect(text).not.toContain('987654');
    expect(text).not.toContain('555444');
  });
});
