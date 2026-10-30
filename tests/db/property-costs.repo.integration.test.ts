import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  accountsRepo,
  newId,
  propertiesRepo,
  propertyCostsRepo,
  transactionsRepo,
  type PoolContext,
  type PoolTx,
  type PropertyCostValues,
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

const makeAccount = async (tx: PoolTx, ctx: PoolContext) => {
  const id = newId();
  await accountsRepo.insert(tx, ctx, id, {
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
  return id;
};

const makeDebit = async (tx: PoolTx, ctx: PoolContext) => {
  const accountId = await makeAccount(tx, ctx);
  const id = newId();
  await transactionsRepo.insert(tx, ctx, id, {
    accountId,
    date: '2026-04-30',
    description: 'IMI',
    amount: '-412.5',
    categoryId: null,
    transfer: false,
    transferLocked: false,
    manualCategory: false,
    hash: `h-${id}`,
  });
  return id;
};

const cost = (propertyId: string, patch: Partial<PropertyCostValues> = {}): PropertyCostValues => ({
  propertyId,
  kind: 'imi',
  name: null,
  amount: '412.5',
  periodicity: 'annual',
  intervalMonths: 12,
  startDate: '2024-04-30',
  endDate: null,
  accountId: null,
  ...patch,
});

const makeCost = async (tx: PoolTx, ctx: PoolContext, patch: Partial<PropertyCostValues> = {}) => {
  const propertyId = await makeProperty(tx, ctx);
  const id = newId();
  await propertyCostsRepo.insert(tx, ctx, id, cost(propertyId, patch));
  return { id, propertyId };
};

describe('property costs and their paid occurrences', () => {
  it('stores a cost, lists it and keeps money exact', async () => {
    const { a } = createTwoPools();
    const { id, propertyId } = await withPool(a.ctx, (tx) =>
      makeCost(tx, a.ctx, { amount: '0.1' }),
    );
    const found = await withPool(a.ctx, (tx) => propertyCostsRepo.find(tx, a.ctx, id));
    expect(found).toMatchObject({ amount: '0.1000', intervalMonths: 12, propertyId });
    const listed = await withPool(a.ctx, (tx) => propertyCostsRepo.list(tx, a.ctx, propertyId));
    expect(listed.map((row) => row.id)).toEqual([id]);
    expect(await withPool(a.ctx, (tx) => propertyCostsRepo.list(tx, a.ctx, newId()))).toEqual([]);
  });

  it('updates a cost and deletes it with the occurrences it paid', async () => {
    const { a } = createTwoPools();
    const { id, propertyId } = await withPool(a.ctx, (tx) => makeCost(tx, a.ctx));
    const movement = await withPool(a.ctx, (tx) => makeDebit(tx, a.ctx));
    await withPool(a.ctx, (tx) =>
      propertyCostsRepo.insertPayment(tx, a.ctx, newId(), id, '2026-04-30', movement),
    );
    const updated = await withPool(a.ctx, (tx) =>
      propertyCostsRepo.update(
        tx,
        a.ctx,
        id,
        cost(propertyId, { kind: 'other', name: 'Jardim', amount: '99' }),
      ),
    );
    expect(updated).toMatchObject({ kind: 'other', name: 'Jardim', amount: '99.0000' });
    expect(await withPool(a.ctx, (tx) => propertyCostsRepo.remove(tx, a.ctx, id))).toBe(true);
    expect(await withPool(a.ctx, (tx) => propertyCostsRepo.listPayments(tx, a.ctx))).toEqual([]);
    expect(await withPool(a.ctx, (tx) => propertyCostsRepo.remove(tx, a.ctx, id))).toBe(false);
  });

  it('pays an occurrence with a movement and takes the link away', async () => {
    const { a } = createTwoPools();
    const { id } = await withPool(a.ctx, (tx) => makeCost(tx, a.ctx));
    const movement = await withPool(a.ctx, (tx) => makeDebit(tx, a.ctx));
    const paymentId = newId();
    await withPool(a.ctx, (tx) =>
      propertyCostsRepo.insertPayment(tx, a.ctx, paymentId, id, '2026-04-30', movement),
    );
    expect(
      await withPool(a.ctx, (tx) => propertyCostsRepo.findPayment(tx, a.ctx, id, '2026-04-30')),
    ).toMatchObject({ id: paymentId, transactionId: movement });
    expect(
      await withPool(a.ctx, (tx) => propertyCostsRepo.removePayment(tx, a.ctx, id, '2026-04-30')),
    ).toBe(true);
    expect(
      await withPool(a.ctx, (tx) => propertyCostsRepo.findPayment(tx, a.ctx, id, '2026-04-30')),
    ).toBeUndefined();
  });

  it('one occurrence takes one movement, and one movement pays one occurrence', async () => {
    const { a } = createTwoPools();
    const { id } = await withPool(a.ctx, (tx) => makeCost(tx, a.ctx));
    const first = await withPool(a.ctx, (tx) => makeDebit(tx, a.ctx));
    const second = await withPool(a.ctx, (tx) => makeDebit(tx, a.ctx));
    await withPool(a.ctx, (tx) =>
      propertyCostsRepo.insertPayment(tx, a.ctx, newId(), id, '2026-04-30', first),
    );
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          propertyCostsRepo.insertPayment(tx, a.ctx, newId(), id, '2026-04-30', second),
        ),
      ),
    ).toBe(UNIQUE_VIOLATION);
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          propertyCostsRepo.insertPayment(tx, a.ctx, newId(), id, '2027-04-30', first),
        ),
      ),
    ).toBe(UNIQUE_VIOLATION);
  });

  it('drops the paid occurrence when the movement is deleted: it is expected again', async () => {
    const { a } = createTwoPools();
    const { id } = await withPool(a.ctx, (tx) => makeCost(tx, a.ctx));
    const movement = await withPool(a.ctx, (tx) => makeDebit(tx, a.ctx));
    await withPool(a.ctx, (tx) =>
      propertyCostsRepo.insertPayment(tx, a.ctx, newId(), id, '2026-04-30', movement),
    );
    await withPool(a.ctx, (tx) => transactionsRepo.remove(tx, a.ctx, movement));
    expect(await withPool(a.ctx, (tx) => propertyCostsRepo.listPayments(tx, a.ctx, [id]))).toEqual(
      [],
    );
  });

  it('blocks deleting a property that has costs, and a cost cannot point at a missing property or account', async () => {
    const { a } = createTwoPools();
    const { propertyId } = await withPool(a.ctx, (tx) => makeCost(tx, a.ctx));
    expect(
      await failureCodeOf(withPool(a.ctx, (tx) => propertiesRepo.remove(tx, a.ctx, propertyId))),
    ).toBe(FOREIGN_KEY_VIOLATION);
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) => propertyCostsRepo.insert(tx, a.ctx, newId(), cost(newId()))),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          propertyCostsRepo.insert(tx, a.ctx, newId(), cost(propertyId, { accountId: newId() })),
        ),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });

  it('refuses rows the checks forbid', async () => {
    const { a } = createTwoPools();
    const propertyId = await withPool(a.ctx, (tx) => makeProperty(tx, a.ctx));
    const bad = (patch: Partial<PropertyCostValues>) =>
      failureCodeOf(
        withPool(a.ctx, (tx) =>
          propertyCostsRepo.insert(tx, a.ctx, newId(), cost(propertyId, patch)),
        ),
      );
    expect(await bad({ kind: 'rent' })).toBe(CHECK_VIOLATION);
    expect(await bad({ amount: '0' })).toBe(CHECK_VIOLATION);
    expect(await bad({ periodicity: 'weekly' })).toBe(CHECK_VIOLATION);
    // Monthly means 1, annual means 12, custom is 1–60.
    expect(await bad({ periodicity: 'monthly', intervalMonths: 12 })).toBe(CHECK_VIOLATION);
    expect(await bad({ periodicity: 'annual', intervalMonths: 1 })).toBe(CHECK_VIOLATION);
    expect(await bad({ periodicity: 'custom', intervalMonths: 61 })).toBe(CHECK_VIOLATION);
    expect(await bad({ kind: 'other', name: null })).toBe(CHECK_VIOLATION);
    expect(await bad({ endDate: '2024-04-29' })).toBe(CHECK_VIOLATION);
    expect(await bad({ name: '' })).toBe(CHECK_VIOLATION);
  });
});

describe('injection payloads are data', () => {
  it.each([`' OR 1=1 --`, `'; DROP TABLE property_costs; --`])(
    'a hostile %j in the name is stored and read back literally',
    async (payload) => {
      const { a } = createTwoPools();
      const { id } = await withPool(a.ctx, (tx) =>
        makeCost(tx, a.ctx, { kind: 'other', name: payload }),
      );
      const row = await withPool(a.ctx, (tx) => propertyCostsRepo.find(tx, a.ctx, id));
      expect(row?.name).toBe(payload);
      expect(await withPool(a.ctx, (tx) => propertyCostsRepo.list(tx, a.ctx))).toHaveLength(1);
    },
  );

  it('a hostile id or date finds nothing and breaks nothing (refused as a uuid or a date)', async () => {
    const { a } = createTwoPools();
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) => propertyCostsRepo.find(tx, a.ctx, `' OR 1=1 --`)),
      ),
    ).toBe(PG.invalidText);
    const { id } = await withPool(a.ctx, (tx) => makeCost(tx, a.ctx));
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) => propertyCostsRepo.findPayment(tx, a.ctx, id, `' OR 1=1 --`)),
      ),
    ).toBeDefined();
    expect(await withPool(a.ctx, (tx) => propertyCostsRepo.list(tx, a.ctx))).toHaveLength(1);
  });
});

describe('isolation between pools (repository filter and RLS)', () => {
  const seed = async (tx: PoolTx, ctxB: PoolContext) => {
    const { id, propertyId } = await makeCost(tx, ctxB, { kind: 'other', name: 'Jardim Beta' });
    const movementId = await makeDebit(tx, ctxB);
    await propertyCostsRepo.insertPayment(tx, ctxB, newId(), id, '2026-04-30', movementId);
    return { costId: id, propertyId, movementId };
  };
  const snapshot = async (tx: PoolTx, ctxB: PoolContext) => ({
    costs: await propertyCostsRepo.list(tx, ctxB),
    payments: await propertyCostsRepo.listPayments(tx, ctxB),
  });
  type Seed = Awaited<ReturnType<typeof seed>>;
  const check = (run: (tx: PoolTx, ctxA: PoolContext, seeded: Seed) => Promise<unknown>) =>
    expectIsolated({ database, seed, snapshot, run });

  it('list finds nothing of pool B', () =>
    check((tx, ctxA, s) => propertyCostsRepo.list(tx, ctxA, s.propertyId)));
  it('find finds nothing of pool B', () =>
    check((tx, ctxA, s) => propertyCostsRepo.find(tx, ctxA, s.costId)));
  it('update changes nothing of pool B', () =>
    check((tx, ctxA, s) =>
      propertyCostsRepo.update(tx, ctxA, s.costId, cost(s.propertyId, { amount: '1' })),
    ));
  it('remove deletes nothing of pool B', () =>
    check((tx, ctxA, s) => propertyCostsRepo.remove(tx, ctxA, s.costId)));
  it('listPayments finds nothing of pool B', () =>
    check((tx, ctxA, s) => propertyCostsRepo.listPayments(tx, ctxA, [s.costId])));
  it('findPayment finds nothing of pool B', () =>
    check((tx, ctxA, s) => propertyCostsRepo.findPayment(tx, ctxA, s.costId, '2026-04-30')));
  it('removePayment deletes nothing of pool B', () =>
    check((tx, ctxA, s) => propertyCostsRepo.removePayment(tx, ctxA, s.costId, '2026-04-30')));

  it('RLS: a raw select without the pool filter sees only the own pool', async () => {
    const { a, b } = createTwoPools();
    await withPool(a.ctx, async (tx) => {
      const { id } = await makeCost(tx, a.ctx);
      const movement = await makeDebit(tx, a.ctx);
      await propertyCostsRepo.insertPayment(tx, a.ctx, newId(), id, '2026-04-30', movement);
    });
    await withPool(b.ctx, (tx) => seed(tx, b.ctx));
    const costs = await withPool(a.ctx, (tx) =>
      tx.execute(sql`select pool_id from property_costs`),
    );
    const payments = await withPool(a.ctx, (tx) =>
      tx.execute(sql`select pool_id from property_cost_payments`),
    );
    for (const found of [costs, payments]) {
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
            sql`insert into property_costs (id, pool_id, property_id, kind, amount, periodicity, interval_months, start_date)
                values (${newId()}, ${b.ctx.poolId}, ${seeded.propertyId}, 'imi', 1, 'annual', 12, '2026-01-01')`,
          ),
        ),
      ),
    ).toBe(PG.rlsViolation);
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          propertyCostsRepo.insert(tx, a.ctx, newId(), cost(seeded.propertyId)),
        ),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          propertyCostsRepo.insertPayment(
            tx,
            a.ctx,
            newId(),
            seeded.costId,
            '2027-04-30',
            seeded.movementId,
          ),
        ),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });
});
