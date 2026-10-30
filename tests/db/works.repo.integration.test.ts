import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  accountsRepo,
  newId,
  propertiesRepo,
  transactionsRepo,
  worksRepo,
  type PoolContext,
  type PoolTx,
  type WorksPaymentValues,
  type WorksProjectValues,
} from '@nestvault/db';

import { expectIsolated } from '../support/expect-isolated';

import { createTwoPools, failureCodeOf, openTestDatabase, PG } from './harness';

const database = openTestDatabase(2);
const { withPool } = database;

beforeEach(async () => {
  await database.truncateAll();
});

afterAll(async () => {
  await database.close();
});

const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';

const makeProperty = async (tx: PoolTx, ctx: PoolContext) => {
  const id = newId();
  await propertiesRepo.insert(tx, ctx, id, {
    name: 'Casa',
    type: 'primary_home',
    address: null,
    purchaseDate: '2020-09-01',
    purchasePrice: '124000',
    downPayment: '12400',
    deedCost: '0',
    imt: '0',
    stampDuty: '0',
    registrationCost: '0',
    bankFees: '0',
    sellingCostPct: null,
    includeInNetWorth: true,
  });
  return id;
};

const project = (
  propertyId: string,
  patch: Partial<WorksProjectValues> = {},
): WorksProjectValues => ({
  propertyId,
  name: 'Cozinha',
  description: null,
  supplier: 'Carpintaria Silva',
  budget: '9166',
  depositPct: '30',
  status: 'planned',
  startDate: '2026-02-01',
  plannedEnd: '2026-05-01',
  notes: null,
  ...patch,
});

const phase = (patch: Partial<WorksPaymentValues> = {}): WorksPaymentValues => ({
  description: 'Sinal',
  amount: '4900',
  plannedDate: '2026-02-01',
  paidDate: null,
  status: 'planned',
  ...patch,
});

const makeProject = async (
  tx: PoolTx,
  ctx: PoolContext,
  patch: Partial<WorksProjectValues> = {},
) => {
  const propertyId = await makeProperty(tx, ctx);
  const id = newId();
  await worksRepo.insertProject(tx, ctx, id, project(propertyId, patch));
  return { id, propertyId };
};

const makeDebit = async (tx: PoolTx, ctx: PoolContext) => {
  const accountId = newId();
  await accountsRepo.insert(tx, ctx, accountId, {
    type: 'checking',
    name: 'Conta',
    institution: null,
    iban: null,
    currency: 'EUR',
    opening: '0',
    openingDate: null,
    trackCash: true,
    groupName: null,
    portfolioId: null,
    rate: null,
    xtbAccountNo: null,
  });
  const id = newId();
  await transactionsRepo.insert(tx, ctx, id, {
    accountId,
    date: '2026-02-03',
    description: 'TRF CARPINTARIA',
    amount: '-4900',
    categoryId: null,
    transfer: false,
    transferLocked: false,
    manualCategory: false,
    hash: `h-${id}`,
  });
  return id;
};

describe('works projects and phases', () => {
  it('stores a project and its phases, lists them and keeps money exact', async () => {
    const { a } = createTwoPools();
    const { id, propertyId } = await withPool(a.ctx, (tx) => makeProject(tx, a.ctx));
    const phaseIds = [newId(), newId()];
    await withPool(a.ctx, async (tx) => {
      await worksRepo.insertPayment(
        tx,
        a.ctx,
        id,
        phaseIds[1] ?? '',
        phase({ plannedDate: '2026-04-01', amount: '0.1' }),
      );
      await worksRepo.insertPayment(tx, a.ctx, id, phaseIds[0] ?? '', phase());
    });
    const found = await withPool(a.ctx, (tx) => worksRepo.findProject(tx, a.ctx, id));
    expect(found).toMatchObject({ budget: '9166.0000', depositPct: '30.000000', propertyId });
    expect(
      await withPool(a.ctx, (tx) => worksRepo.listProjects(tx, a.ctx, propertyId)),
    ).toHaveLength(1);
    expect(await withPool(a.ctx, (tx) => worksRepo.listProjects(tx, a.ctx, newId()))).toEqual([]);
    const phases = await withPool(a.ctx, (tx) => worksRepo.listPayments(tx, a.ctx, [id]));
    expect(phases.map((row) => row.amount)).toEqual(['4900.0000', '0.1000']);
    expect(await withPool(a.ctx, (tx) => worksRepo.listPayments(tx, a.ctx, []))).toEqual([]);
  });

  it('updates a project and a phase, and deletes the project with its phases', async () => {
    const { a } = createTwoPools();
    const { id, propertyId } = await withPool(a.ctx, (tx) => makeProject(tx, a.ctx));
    const phaseId = newId();
    await withPool(a.ctx, (tx) => worksRepo.insertPayment(tx, a.ctx, id, phaseId, phase()));
    const updated = await withPool(a.ctx, (tx) =>
      worksRepo.updateProject(
        tx,
        a.ctx,
        id,
        project(propertyId, { name: 'Cozinha nova', status: 'in_progress' }),
      ),
    );
    expect(updated).toMatchObject({ name: 'Cozinha nova', status: 'in_progress' });
    const changed = await withPool(a.ctx, (tx) =>
      worksRepo.updatePayment(
        tx,
        a.ctx,
        id,
        phaseId,
        phase({ paidDate: '2026-02-05', status: 'paid' }),
      ),
    );
    expect(changed).toMatchObject({ status: 'paid', paidDate: '2026-02-05' });
    expect(await withPool(a.ctx, (tx) => worksRepo.removeProject(tx, a.ctx, id))).toBe(true);
    expect(await withPool(a.ctx, (tx) => worksRepo.listPayments(tx, a.ctx))).toEqual([]);
  });

  it('links a movement (the phase is paid on its date) and unlinks it', async () => {
    const { a } = createTwoPools();
    const { id } = await withPool(a.ctx, (tx) => makeProject(tx, a.ctx));
    const phaseId = newId();
    const movement = await withPool(a.ctx, async (tx) => {
      await worksRepo.insertPayment(tx, a.ctx, id, phaseId, phase());
      return makeDebit(tx, a.ctx);
    });
    const linked = await withPool(a.ctx, (tx) =>
      worksRepo.linkTransaction(tx, a.ctx, id, phaseId, movement, '2026-02-03'),
    );
    expect(linked).toMatchObject({
      status: 'paid',
      paidDate: '2026-02-03',
      transactionId: movement,
    });
    const unlinked = await withPool(a.ctx, (tx) =>
      worksRepo.unlinkTransaction(tx, a.ctx, id, phaseId),
    );
    expect(unlinked).toMatchObject({ status: 'planned', paidDate: null, transactionId: null });
  });

  it('one movement pays one phase only', async () => {
    const { a } = createTwoPools();
    const { id } = await withPool(a.ctx, (tx) => makeProject(tx, a.ctx));
    const [first, second] = [newId(), newId()];
    const movement = await withPool(a.ctx, async (tx) => {
      await worksRepo.insertPayment(tx, a.ctx, id, first, phase());
      await worksRepo.insertPayment(tx, a.ctx, id, second, phase({ description: 'Segunda' }));
      return makeDebit(tx, a.ctx);
    });
    await withPool(a.ctx, (tx) =>
      worksRepo.linkTransaction(tx, a.ctx, id, first, movement, '2026-02-03'),
    );
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          worksRepo.linkTransaction(tx, a.ctx, id, second, movement, '2026-02-03'),
        ),
      ),
    ).toBe(UNIQUE_VIOLATION);
  });

  it('keeps the phase paid but unlinked when the movement is deleted', async () => {
    const { a } = createTwoPools();
    const { id } = await withPool(a.ctx, (tx) => makeProject(tx, a.ctx));
    const phaseId = newId();
    const movement = await withPool(a.ctx, async (tx) => {
      await worksRepo.insertPayment(tx, a.ctx, id, phaseId, phase());
      return makeDebit(tx, a.ctx);
    });
    await withPool(a.ctx, (tx) =>
      worksRepo.linkTransaction(tx, a.ctx, id, phaseId, movement, '2026-02-03'),
    );
    // The check "linked ⇒ paid" must still hold after the foreign key nulls only `transaction_id`.
    await withPool(a.ctx, (tx) => transactionsRepo.remove(tx, a.ctx, movement));
    const row = await withPool(a.ctx, (tx) => worksRepo.findPayment(tx, a.ctx, id, phaseId));
    expect(row).toMatchObject({ poolId: a.ctx.poolId, transactionId: null, status: 'paid' });
  });

  it('blocks deleting a property that has works, and the project cannot point at a missing property', async () => {
    const { a } = createTwoPools();
    const { propertyId } = await withPool(a.ctx, (tx) => makeProject(tx, a.ctx));
    expect(
      await failureCodeOf(withPool(a.ctx, (tx) => propertiesRepo.remove(tx, a.ctx, propertyId))),
    ).toBe(FOREIGN_KEY_VIOLATION);
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) => worksRepo.insertProject(tx, a.ctx, newId(), project(newId()))),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) => worksRepo.insertPayment(tx, a.ctx, newId(), newId(), phase())),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });

  it.each([
    ['an empty name', { name: '' }],
    ['a name over 80 characters', { name: 'x'.repeat(81) }],
    ['an empty supplier', { supplier: '' }],
    ['a negative budget', { budget: '-1' }],
    ['a deposit above 100', { depositPct: '100.5' }],
    ['an unknown status', { status: 'abandoned' }],
    ['an end before the start', { startDate: '2026-05-01', plannedEnd: '2026-04-30' }],
  ] as [string, Partial<WorksProjectValues>][])(
    'refuses %s (check constraint)',
    async (_n, patch) => {
      const { a } = createTwoPools();
      expect(
        await failureCodeOf(
          withPool(a.ctx, async (tx) => {
            const propertyId = await makeProperty(tx, a.ctx);
            await worksRepo.insertProject(tx, a.ctx, newId(), project(propertyId, patch));
          }),
        ),
      ).toBe(CHECK_VIOLATION);
    },
  );

  it.each([
    ['an empty description', { description: '' }],
    ['a zero amount', { amount: '0' }],
    ['an unknown status', { status: 'late' }],
    ['paid without a paid date', { status: 'paid', paidDate: null }],
    ['planned with a paid date', { status: 'planned', paidDate: '2026-02-05' }],
  ] as [string, Partial<WorksPaymentValues>][])(
    'refuses a phase with %s (check constraint)',
    async (_n, patch) => {
      const { a } = createTwoPools();
      const { id } = await withPool(a.ctx, (tx) => makeProject(tx, a.ctx));
      expect(
        await failureCodeOf(
          withPool(a.ctx, (tx) => worksRepo.insertPayment(tx, a.ctx, id, newId(), phase(patch))),
        ),
      ).toBe(CHECK_VIOLATION);
    },
  );

  it('refuses a linked movement on a phase that is not paid', async () => {
    const { a } = createTwoPools();
    const { id } = await withPool(a.ctx, (tx) => makeProject(tx, a.ctx));
    const movement = await withPool(a.ctx, (tx) => makeDebit(tx, a.ctx));
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          tx.execute(
            sql`insert into works_payments (id, pool_id, project_id, description, amount, status, transaction_id)
                values (${newId()}, ${a.ctx.poolId}, ${id}, 'x', 1, 'planned', ${movement})`,
          ),
        ),
      ),
    ).toBe(CHECK_VIOLATION);
  });
});

describe('injection payloads are data', () => {
  it.each([`' OR 1=1 --`, `'; DROP TABLE works_projects; --`])(
    'a hostile %j in text fields is stored and read back literally',
    async (payload) => {
      const { a } = createTwoPools();
      const { id } = await withPool(a.ctx, (tx) =>
        makeProject(tx, a.ctx, {
          name: payload,
          supplier: payload,
          description: payload,
          notes: payload,
        }),
      );
      await withPool(a.ctx, (tx) =>
        worksRepo.insertPayment(tx, a.ctx, id, newId(), phase({ description: payload })),
      );
      const row = await withPool(a.ctx, (tx) => worksRepo.findProject(tx, a.ctx, id));
      expect(row).toMatchObject({
        name: payload,
        supplier: payload,
        description: payload,
        notes: payload,
      });
      const phases = await withPool(a.ctx, (tx) => worksRepo.listPayments(tx, a.ctx, [id]));
      expect(phases[0]?.description).toBe(payload);
      expect(await withPool(a.ctx, (tx) => worksRepo.listProjects(tx, a.ctx))).toHaveLength(1);
    },
  );

  it('a hostile id finds nothing and breaks nothing (refused as a uuid)', async () => {
    const { a } = createTwoPools();
    expect(
      await failureCodeOf(withPool(a.ctx, (tx) => worksRepo.findProject(tx, a.ctx, `' OR 1=1 --`))),
    ).toBe(PG.invalidText);
  });
});

describe('isolation between pools (repository filter and RLS)', () => {
  const seed = async (tx: PoolTx, ctxB: PoolContext) => {
    const { id, propertyId } = await makeProject(tx, ctxB, { name: 'Cozinha Beta Secreta' });
    const phaseId = newId();
    await worksRepo.insertPayment(tx, ctxB, id, phaseId, phase({ amount: '654321' }));
    const movementId = await makeDebit(tx, ctxB);
    return { projectId: id, propertyId, phaseId, movementId };
  };
  const snapshot = async (tx: PoolTx, ctxB: PoolContext, s: { projectId: string }) => ({
    projects: await worksRepo.listProjects(tx, ctxB),
    phases: await worksRepo.listPayments(tx, ctxB, [s.projectId]),
  });
  type Seed = Awaited<ReturnType<typeof seed>>;
  const check = (run: (tx: PoolTx, ctxA: PoolContext, seeded: Seed) => Promise<unknown>) =>
    expectIsolated({ database, seed, snapshot, run });

  it('listProjects finds nothing of pool B', () =>
    check((tx, ctxA, s) => worksRepo.listProjects(tx, ctxA, s.propertyId)));
  it('findProject finds nothing of pool B', () =>
    check((tx, ctxA, s) => worksRepo.findProject(tx, ctxA, s.projectId)));
  it('updateProject changes nothing of pool B', () =>
    check((tx, ctxA, s) =>
      worksRepo.updateProject(tx, ctxA, s.projectId, project(s.propertyId, { name: 'hijacked' })),
    ));
  it('removeProject deletes nothing of pool B', () =>
    check((tx, ctxA, s) => worksRepo.removeProject(tx, ctxA, s.projectId)));
  it('listPayments finds nothing of pool B', () =>
    check((tx, ctxA, s) => worksRepo.listPayments(tx, ctxA, [s.projectId])));
  it('findPayment finds nothing of pool B', () =>
    check((tx, ctxA, s) => worksRepo.findPayment(tx, ctxA, s.projectId, s.phaseId)));
  it('updatePayment changes nothing of pool B', () =>
    check((tx, ctxA, s) =>
      worksRepo.updatePayment(tx, ctxA, s.projectId, s.phaseId, phase({ description: 'hijacked' })),
    ));
  it('linkTransaction changes nothing of pool B', () =>
    check((tx, ctxA, s) =>
      worksRepo.linkTransaction(tx, ctxA, s.projectId, s.phaseId, s.movementId, '2026-02-03'),
    ));
  it('unlinkTransaction changes nothing of pool B', () =>
    check((tx, ctxA, s) => worksRepo.unlinkTransaction(tx, ctxA, s.projectId, s.phaseId)));
  it('removePayment deletes nothing of pool B', () =>
    check((tx, ctxA, s) => worksRepo.removePayment(tx, ctxA, s.projectId, s.phaseId)));

  it('RLS: a raw select without the pool filter sees only the own pool', async () => {
    const { a, b } = createTwoPools();
    await withPool(a.ctx, async (tx) => {
      const { id } = await makeProject(tx, a.ctx);
      await worksRepo.insertPayment(tx, a.ctx, id, newId(), phase());
    });
    await withPool(b.ctx, (tx) => seed(tx, b.ctx));
    const projects = await withPool(a.ctx, (tx) =>
      tx.execute(sql`select pool_id from works_projects`),
    );
    const payments = await withPool(a.ctx, (tx) =>
      tx.execute(sql`select pool_id from works_payments`),
    );
    for (const found of [projects, payments]) {
      expect(found.rows).toHaveLength(1);
      expect(found.rows.every((row) => row['pool_id'] === a.ctx.poolId)).toBe(true);
    }
  });

  it('RLS and composite keys: pool A cannot write into pool B or onto its rows', async () => {
    const { a, b } = createTwoPools();
    const seeded = await withPool(b.ctx, (tx) => seed(tx, b.ctx));
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          tx.execute(
            sql`insert into works_projects (id, pool_id, property_id, name, budget)
                values (${newId()}, ${b.ctx.poolId}, ${seeded.propertyId}, 'x', 1)`,
          ),
        ),
      ),
    ).toBe(PG.rlsViolation);
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          worksRepo.insertPayment(tx, a.ctx, seeded.projectId, newId(), phase()),
        ),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          worksRepo.insertProject(tx, a.ctx, newId(), project(seeded.propertyId)),
        ),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });
});
