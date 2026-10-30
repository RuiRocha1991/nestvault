import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ConflictError,
  createEntitlements,
  createWorksService,
  ForbiddenError,
  logger,
  NotFoundError,
  PaymentDto,
  PlanLimitError,
  UnauthorizedError,
  UpcomingDto,
  ValidationError,
  WorkDto,
  WorkListDto,
  type WorksService,
} from '@nestvault/services';

import { createApiWorld, type ApiWorld, type Persona, type Scenario } from '../support/api-world';
import { rows } from '../support/auth-harness';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let world: ApiWorld;
let s: Scenario;
// The world's service has billing off (every pool is Pro); this one has it on: a pool without a
// subscription is Free.
let billed: WorksService;

beforeAll(async () => {
  logger.level = 'silent';
  world = await createApiWorld();
  billed = createWorksService({
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

const create = async (as: Persona = 'owner', patch: object = {}, poolId = s.poolA) => {
  const property = await makeProperty(poolId);
  return world.works.create(await s.as(as), poolId, {
    propertyId: property.id,
    name: 'Cozinha',
    supplier: 'Carpintaria Silva',
    budget: '9166',
    ...patch,
  });
};
const addPhase = async (workId: string, body: object, poolId = s.poolA) =>
  world.works.addPayment(await s.as(ownerOf(poolId)), poolId, workId, body);

/** A debit of the pool, to pay a phase with. */
const makeDebit = async (amount = '-4900', poolId = s.poolA) => {
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
    date: '2026-02-03',
    description: 'TRF CARPINTARIA',
    amount,
  });
};
const subscribe = (plan: string) =>
  world.identity.db.execute(
    sql`insert into pool_subscriptions (pool_id, plan, status) values (${s.poolA}, ${plan}, 'active')`,
  );

describe('works service', () => {
  it('opens a project with nothing paid yet and the deposit worked out', async () => {
    const created = await create('owner', { depositPct: '30', status: 'in_progress' });
    expect(WorkDto.parse(created)).toEqual(created);
    expect(created).toMatchObject({
      name: 'Cozinha',
      supplier: 'Carpintaria Silva',
      budget: '9166.0000',
      status: 'in_progress',
      depositAmount: '2749.8',
      phases: [],
      totals: { planned: '0', paid: '0', outstanding: '9166', unplanned: '9166', phases: 0 },
    });
  });

  it('lets owner and admin write; refuses member and viewer (403); everybody reads', async () => {
    for (const as of ['owner', 'admin'] as const) await create(as);
    for (const as of ['member', 'viewer'] as const) {
      await expect(create(as)).rejects.toBeInstanceOf(ForbiddenError);
    }
    for (const as of ['owner', 'admin', 'member', 'viewer'] as const) {
      const list = await world.works.list(await s.as(as), s.poolA);
      expect(WorkListDto.parse(list)).toEqual(list);
      expect(list.projects).toHaveLength(2);
    }
  });

  it('answers 401 without a session and 404 to a non-member', async () => {
    await expect(world.works.list(new Headers(), s.poolA)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(world.works.list(await s.as('outsider'), s.poolA)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      world.works.create(await s.as('outsider'), s.poolA, {
        propertyId: anyId,
        name: 'X',
        budget: '1',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses what is not valid (400) and extra fields such as poolId', async () => {
    const property = await makeProperty();
    const owner = await s.as('owner');
    const bad = (body: object) =>
      world.works.create(owner, s.poolA, {
        propertyId: property.id,
        name: 'X',
        budget: '1',
        ...body,
      });
    for (const body of [
      { poolId: s.poolB },
      { id: anyId },
      { name: '' },
      { name: 'a\u0000b' },
      { budget: '-1' },
      { budget: '1e3' },
      { budget: '10.12345' },
      { depositPct: '101' },
      { status: 'abandoned' },
      { startDate: '2026-02-30' },
      { startDate: '2026-05-01', plannedEnd: '2026-04-01' },
    ]) {
      await expect(bad(body), JSON.stringify(body)).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(
      world.works.create(owner, s.poolA, { name: 'X', budget: '1' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses a property of another pool (400) and writes nothing', async () => {
    const theirs = await makeProperty(s.poolB);
    await expect(
      world.works.create(await s.as('owner'), s.poolA, {
        propertyId: theirs.id,
        name: 'X',
        budget: '1',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await world.works.list(await s.as('owner'), s.poolA)).projects).toEqual([]);
  });

  it('changes only what is sent and keeps the property', async () => {
    const created = await create('owner', {
      description: 'Móveis e bancada',
      notes: 'Pedir fatura',
    });
    const owner = await s.as('owner');
    const updated = await world.works.update(owner, s.poolA, created.id, {
      name: 'Cozinha nova',
      supplier: null,
      status: 'done',
    });
    expect(updated).toMatchObject({
      name: 'Cozinha nova',
      supplier: null,
      status: 'done',
      description: 'Móveis e bancada',
      notes: 'Pedir fatura',
      propertyId: created.propertyId,
      budget: '9166.0000',
    });
    await expect(
      world.works.update(owner, s.poolA, created.id, { propertyId: anyId }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      world.works.update(owner, s.poolA, created.id, {
        startDate: '2026-09-01',
        plannedEnd: '2026-08-01',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('keeps notes and descriptions exactly as written, and a hostile string is data', async () => {
    const payload = `<script>alert(1)</script> ' OR 1=1 --`;
    const created = await create('owner', {
      name: `'; DROP TABLE works_projects; --`,
      notes: payload,
    });
    const read = await world.works.get(await s.as('viewer'), s.poolA, created.id);
    expect(read).toMatchObject({ name: `'; DROP TABLE works_projects; --`, notes: payload });
    expect((await world.works.list(await s.as('owner'), s.poolA)).projects).toHaveLength(1);
  });

  it('deletes a project with its phases and answers 404 afterwards', async () => {
    const created = await create();
    await addPhase(created.id, { description: 'Sinal', amount: '100' });
    const owner = await s.as('owner');
    await world.works.remove(owner, s.poolA, created.id);
    await expect(world.works.get(owner, s.poolA, created.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(world.works.remove(owner, s.poolA, created.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(world.works.get(owner, s.poolA, `' OR 1=1 --`)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('does not show or touch the projects of another pool (404)', async () => {
    const other = await create('outsider', { name: 'Cozinha Beta Secreta' }, s.poolB);
    const owner = await s.as('owner');
    expect((await world.works.list(owner, s.poolA)).projects).toEqual([]);
    await expect(world.works.get(owner, s.poolA, other.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.works.update(owner, s.poolA, other.id, { name: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(world.works.remove(owner, s.poolA, other.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      world.works.addPayment(owner, s.poolA, other.id, { description: 'x', amount: '1' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await world.works.get(await s.as('outsider'), s.poolB, other.id)).name).toBe(
      'Cozinha Beta Secreta',
    );
  });
});

describe('phases and totals', () => {
  // The kitchen of the PRD: 4 900 + 2 460 + 1 230 + 576 = 9 166 €.
  const kitchen = async () => {
    const created = await create();
    for (const [description, amount, plannedDate] of [
      ['Sinal', '4900', '2026-02-01'],
      ['Montagem', '2460', '2026-03-15'],
      ['Eletrodomésticos', '1230', '2026-03-20'],
      ['Acabamentos', '576', '2026-04-10'],
    ]) {
      await addPhase(created.id, { description, amount, plannedDate });
    }
    return created;
  };

  it('adds up planned, paid and outstanding from the phases', async () => {
    const created = await kitchen();
    const owner = await s.as('owner');
    let read = await world.works.get(owner, s.poolA, created.id);
    expect(read.totals).toMatchObject({
      budget: '9166',
      planned: '9166',
      paid: '0',
      outstanding: '9166',
      unplanned: '0',
      phases: 4,
      paidPhases: 0,
    });
    const [first] = read.phases;
    const paid = await world.works.updatePayment(owner, s.poolA, created.id, first?.id ?? '', {
      paidDate: '2026-02-04',
    });
    expect(PaymentDto.parse(paid)).toEqual(paid);
    expect(paid).toMatchObject({ status: 'paid', paidDate: '2026-02-04', delayDays: 3 });
    read = await world.works.get(owner, s.poolA, created.id);
    expect(read.totals).toMatchObject({ paid: '4900', outstanding: '4266', paidPhases: 1 });
    // Clearing the date plans it again.
    const again = await world.works.updatePayment(owner, s.poolA, created.id, first?.id ?? '', {
      paidDate: null,
    });
    expect(again).toMatchObject({ status: 'planned', paidDate: null, delayDays: null });
  });

  it('totals the projects of a property: the 4 works of the reference', async () => {
    const property = await makeProperty();
    const owner = await s.as('owner');
    const budgets = ['9166', '5000.46', '4905', '3000'];
    for (const [index, budget] of budgets.entries()) {
      const work = await world.works.create(owner, s.poolA, {
        propertyId: property.id,
        name: `Obra ${String(index)}`,
        budget,
        status: 'done',
      });
      const phase = await world.works.addPayment(owner, s.poolA, work.id, {
        description: 'Tudo',
        amount: budget,
      });
      await world.works.updatePayment(owner, s.poolA, work.id, phase.id, {
        paidDate: '2025-06-01',
      });
    }
    const list = await world.works.list(owner, s.poolA, property.id);
    expect(list.byProperty).toHaveLength(1);
    expect(list.byProperty[0]).toMatchObject({
      propertyId: property.id,
      projects: 4,
      byStatus: { planned: 0, in_progress: 0, done: 4 },
      paid: '22071.46',
      outstanding: '0',
    });
  });

  it('filters by property and refuses a malformed filter', async () => {
    const created = await create();
    await create();
    const owner = await s.as('owner');
    const list = await world.works.list(owner, s.poolA, created.propertyId);
    expect(list.projects.map((row) => row.id)).toEqual([created.id]);
    await expect(world.works.list(owner, s.poolA, `' OR 1=1 --`)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('lists the phases still to pay by month, oldest first, without the paid ones', async () => {
    const created = await kitchen();
    const owner = await s.as('owner');
    const sinal = (await world.works.get(owner, s.poolA, created.id)).phases[0];
    await world.works.updatePayment(owner, s.poolA, created.id, sinal?.id ?? '', {
      paidDate: '2026-02-04',
    });
    await addPhase(created.id, { description: 'Sem data', amount: '10' });
    const upcoming = await world.works.upcoming(owner, s.poolA);
    expect(UpcomingDto.parse(upcoming)).toEqual(upcoming);
    expect(upcoming.months.map((month) => [month.month, month.amount])).toEqual([
      ['2026-03', '3690'],
      ['2026-04', '576'],
    ]);
    expect(upcoming.months[0]?.phases.map((phase) => phase.description)).toEqual([
      'Montagem',
      'Eletrodomésticos',
    ]);
    expect(upcoming.months[0]?.phases[0]).toMatchObject({
      projectId: created.id,
      projectName: 'Cozinha',
    });
  });

  it('refuses invalid phases (400) and a phase of another pool’s project (404)', async () => {
    const created = await create();
    const owner = await s.as('owner');
    for (const body of [
      { description: '', amount: '1' },
      { description: 'x', amount: '0' },
      { description: 'x', amount: '-5' },
      { description: 'x', amount: '1', status: 'paid' },
      { description: 'x', amount: '1', poolId: s.poolB },
    ]) {
      await expect(
        world.works.addPayment(owner, s.poolA, created.id, body),
        JSON.stringify(body),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    const other = await create('outsider', {}, s.poolB);
    const theirs = await addPhase(other.id, { description: 'Secreta', amount: '654321' }, s.poolB);
    await expect(
      world.works.updatePayment(owner, s.poolA, other.id, theirs.id, { description: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // The right phase under the wrong project of the same pool is not found either.
    await expect(
      world.works.removePayment(owner, s.poolA, created.id, theirs.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await world.works.get(await s.as('outsider'), s.poolB, other.id)).phases).toHaveLength(
      1,
    );
  });

  it('deletes a phase', async () => {
    const created = await create();
    const phase = await addPhase(created.id, { description: 'Sinal', amount: '100' });
    const owner = await s.as('owner');
    await world.works.removePayment(owner, s.poolA, created.id, phase.id);
    expect((await world.works.get(owner, s.poolA, created.id)).phases).toEqual([]);
    await expect(
      world.works.removePayment(owner, s.poolA, created.id, phase.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('paying a phase with a bank debit', () => {
  const setup = async () => {
    const created = await create();
    const phase = await addPhase(created.id, {
      description: 'Sinal',
      amount: '4900',
      plannedDate: '2026-02-01',
    });
    return { created, phase, movement: await makeDebit() };
  };
  const categoryOf = async (id: string) => {
    const owner = await s.as('owner');
    const works = (await world.categories.list(owner, s.poolA)).categories.find(
      (entry) => entry.systemKey === 'works',
    );
    const found = (await world.transactions.list(owner, s.poolA)).transactions.find(
      (entry) => entry.id === id,
    );
    return { works: works?.id, found };
  };

  it('marks the phase paid on the movement’s date and files the movement under works', async () => {
    const { created, phase, movement } = await setup();
    const owner = await s.as('owner');
    const linked = await world.works.linkTransaction(owner, s.poolA, created.id, phase.id, {
      transactionId: movement.id,
    });
    expect(linked).toMatchObject({
      status: 'paid',
      paidDate: '2026-02-03',
      transactionId: movement.id,
      delayDays: 2,
    });
    const { works, found } = await categoryOf(movement.id);
    expect(works).toBeDefined();
    expect(found).toMatchObject({ categoryId: works, manualCategory: true });
    expect((await world.works.get(owner, s.poolA, created.id)).totals.paid).toBe('4900');
  });

  it('refuses a second link (409), a movement already used (409) and a paid date change while linked', async () => {
    const { created, phase, movement } = await setup();
    const owner = await s.as('owner');
    await world.works.linkTransaction(owner, s.poolA, created.id, phase.id, {
      transactionId: movement.id,
    });
    await expect(
      world.works.linkTransaction(owner, s.poolA, created.id, phase.id, {
        transactionId: movement.id,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    const second = await addPhase(created.id, { description: 'Outra', amount: '1' });
    await expect(
      world.works.linkTransaction(owner, s.poolA, created.id, second.id, {
        transactionId: movement.id,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      world.works.updatePayment(owner, s.poolA, created.id, phase.id, { paidDate: '2026-02-09' }),
    ).rejects.toBeInstanceOf(ValidationError);
    // The failed attempts left the first link as it was.
    expect((await world.works.get(owner, s.poolA, created.id)).phases[0]).toMatchObject({
      transactionId: movement.id,
      paidDate: '2026-02-03',
    });
  });

  it('refuses a credit, a movement of another pool and an unknown one (400)', async () => {
    const { created, phase } = await setup();
    const owner = await s.as('owner');
    const credit = await makeDebit('250');
    const theirs = await makeDebit('-10', s.poolB);
    for (const transactionId of [credit.id, theirs.id, anyId]) {
      await expect(
        world.works.linkTransaction(owner, s.poolA, created.id, phase.id, { transactionId }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(
      world.works.linkTransaction(owner, s.poolA, created.id, phase.id, {
        transactionId: credit.id,
        poolId: s.poolB,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await world.works.get(owner, s.poolA, created.id)).phases[0]?.status).toBe('planned');
    expect(
      (await world.transactions.list(await s.as('outsider'), s.poolB)).transactions,
    ).toHaveLength(1);
  });

  it('unlinks: the phase is planned again, and the movement keeps its category', async () => {
    const { created, phase, movement } = await setup();
    const owner = await s.as('owner');
    await world.works.linkTransaction(owner, s.poolA, created.id, phase.id, {
      transactionId: movement.id,
    });
    const unlinked = await world.works.unlinkTransaction(owner, s.poolA, created.id, phase.id);
    expect(unlinked).toMatchObject({ status: 'planned', paidDate: null, transactionId: null });
    const { works, found } = await categoryOf(movement.id);
    expect(found?.categoryId).toBe(works);
    await expect(
      world.works.unlinkTransaction(owner, s.poolA, created.id, phase.id),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('only owner and admin link and unlink (403)', async () => {
    const { created, phase, movement } = await setup();
    for (const as of ['member', 'viewer'] as const) {
      const headers = await s.as(as);
      await expect(
        world.works.linkTransaction(headers, s.poolA, created.id, phase.id, {
          transactionId: movement.id,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        world.works.unlinkTransaction(headers, s.poolA, created.id, phase.id),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('deleting the movement keeps the phase paid but unlinked', async () => {
    const { created, phase, movement } = await setup();
    const owner = await s.as('owner');
    await world.works.linkTransaction(owner, s.poolA, created.id, phase.id, {
      transactionId: movement.id,
    });
    await world.transactions.remove(owner, s.poolA, movement.id);
    expect((await world.works.get(owner, s.poolA, created.id)).phases[0]).toMatchObject({
      status: 'paid',
      transactionId: null,
    });
  });
});

describe('plan: works are Pro', () => {
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
    await refused(billed.create(owner, s.poolA, { propertyId: anyId, name: 'X', budget: '1' }));
    await refused(billed.upcoming(owner, s.poolA));
    await refused(billed.addPayment(owner, s.poolA, anyId, { description: 'x', amount: '1' }));
    await refused(billed.linkTransaction(owner, s.poolA, anyId, anyId, { transactionId: anyId }));
    await refused(billed.list(await s.as('viewer'), s.poolA));
    expect(await world.works.list(owner, s.poolA)).toEqual({ projects: [], byProperty: [] });
  });

  it('asks the role first: a viewer who writes gets 403 forbidden, not plan_limit', async () => {
    await expect(
      billed.create(await s.as('viewer'), s.poolA, { propertyId: anyId, name: 'X', budget: '1' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('works on a Pro pool with billing on', async () => {
    await subscribe('pro');
    const property = await makeProperty();
    const created = await billed.create(await s.as('owner'), s.poolA, {
      propertyId: property.id,
      name: 'Cozinha',
      budget: '100',
    });
    expect(created.budget).toBe('100.0000');
    expect((await billed.list(await s.as('member'), s.poolA)).projects).toHaveLength(1);
  });
});

describe('what works block', () => {
  it('a property with works cannot be deleted (409) until the works are gone', async () => {
    const created = await create();
    const owner = await s.as('owner');
    await expect(
      world.properties.remove(owner, s.poolA, created.propertyId),
    ).rejects.toBeInstanceOf(ConflictError);
    await world.works.remove(owner, s.poolA, created.id);
    await world.properties.remove(owner, s.poolA, created.propertyId);
  });
});

describe('audit', () => {
  it('records the changes without amounts, names or notes', async () => {
    const created = await create('owner', {
      budget: '987654',
      name: 'Obra Secreta',
      notes: 'nota privada',
    });
    const owner = await s.as('owner');
    const phase = await world.works.addPayment(owner, s.poolA, created.id, {
      description: 'Fase privada',
      amount: '555444',
    });
    const movement = await makeDebit('-555444');
    await world.works.updatePayment(owner, s.poolA, created.id, phase.id, { description: 'Outra' });
    await world.works.linkTransaction(owner, s.poolA, created.id, phase.id, {
      transactionId: movement.id,
    });
    await world.works.unlinkTransaction(owner, s.poolA, created.id, phase.id);
    await world.works.removePayment(owner, s.poolA, created.id, phase.id);
    await world.works.update(owner, s.poolA, created.id, { status: 'done' });
    await world.works.remove(owner, s.poolA, created.id);
    const log = await rows<{ action: string; entry: string }>(
      world.identity,
      sql`select action, to_jsonb(audit_log)::text as entry from audit_log where action like 'work.%' and target = ${created.id} order by at`,
    );
    expect(log.map((entry) => entry.action)).toEqual([
      'work.created',
      'work.payment_added',
      'work.payment_updated',
      'work.payment_linked',
      'work.payment_unlinked',
      'work.payment_deleted',
      'work.updated',
      'work.deleted',
    ]);
    const text = JSON.stringify(log);
    for (const secret of ['987654', '555444', 'Obra Secreta', 'nota privada', 'Fase privada']) {
      expect(text).not.toContain(secret);
    }
  });
});
