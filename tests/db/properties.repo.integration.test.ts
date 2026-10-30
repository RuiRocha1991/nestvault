import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  holdersRepo,
  newId,
  propertiesRepo,
  type PoolContext,
  type PoolTx,
  type PropertyValues,
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

// The reference property of the owner's spreadsheet.
const values = (patch: Partial<PropertyValues> = {}): PropertyValues => ({
  name: 'Apartamento',
  type: 'primary_home',
  address: 'Rua das Flores 1',
  purchaseDate: '2020-09-01',
  purchasePrice: '124000',
  downPayment: '12400',
  deedCost: '915',
  imt: '631.86',
  stampDuty: '992',
  registrationCost: '0',
  bankFees: '20.85',
  sellingCostPct: '5',
  includeInNetWorth: true,
  ...patch,
});

const person = (tx: PoolTx, ctx: PoolContext, name = 'Ana') =>
  holdersRepo.insert(tx, ctx, newId(), { name, color: '#9D6BFF', aliases: [], userId: null });

describe('properties', () => {
  it('inserts, reads, updates and deletes a property with owners and valuations', async () => {
    const { a } = createTwoPools();
    const id = newId();
    const ana = await withPool(a.ctx, (tx) => person(tx, a.ctx));
    await withPool(a.ctx, async (tx) => {
      await propertiesRepo.insert(tx, a.ctx, id, values());
      await propertiesRepo.replaceHolders(tx, a.ctx, id, [{ holderId: ana.id, sharePct: '100' }]);
      await propertiesRepo.insertValuation(tx, a.ctx, id, {
        date: '2025-01-01',
        value: '150000',
        source: 'bank_appraisal',
      });
    });
    expect(await withPool(a.ctx, (tx) => propertiesRepo.find(tx, a.ctx, id))).toMatchObject({
      name: 'Apartamento',
      purchasePrice: '124000.0000',
      downPayment: '12400.0000',
      deedCost: '915.0000',
      imt: '631.8600',
      stampDuty: '992.0000',
      bankFees: '20.8500',
      sellingCostPct: '5.000000',
      purchaseDate: '2020-09-01',
    });
    expect(await withPool(a.ctx, (tx) => propertiesRepo.listHolders(tx, a.ctx, [id]))).toEqual([
      expect.objectContaining({ holderId: ana.id, sharePct: '100.000000' }),
    ]);
    expect(await withPool(a.ctx, (tx) => propertiesRepo.listValuations(tx, a.ctx, [id]))).toEqual([
      expect.objectContaining({
        date: '2025-01-01',
        value: '150000.0000',
        source: 'bank_appraisal',
      }),
    ]);

    const changed = await withPool(a.ctx, (tx) =>
      propertiesRepo.update(tx, a.ctx, id, values({ name: 'Casa', address: null })),
    );
    expect(changed).toMatchObject({ name: 'Casa', address: null });

    expect(await withPool(a.ctx, (tx) => propertiesRepo.remove(tx, a.ctx, id))).toBe(true);
    // Owners and valuations go with the property.
    expect(await withPool(a.ctx, (tx) => propertiesRepo.listHolders(tx, a.ctx))).toEqual([]);
    expect(await withPool(a.ctx, (tx) => propertiesRepo.listValuations(tx, a.ctx))).toEqual([]);
  });

  it('lists valuations newest first', async () => {
    const { a } = createTwoPools();
    const id = newId();
    await withPool(a.ctx, async (tx) => {
      await propertiesRepo.insert(tx, a.ctx, id, values());
      for (const [date, value] of [
        ['2023-01-01', '130000'],
        ['2025-06-30', '150000'],
        ['2024-03-01', '140000'],
      ] as const) {
        await propertiesRepo.insertValuation(tx, a.ctx, id, { date, value, source: 'manual' });
      }
    });
    const list = await withPool(a.ctx, (tx) => propertiesRepo.listValuations(tx, a.ctx, [id]));
    expect(list.map((valuation) => valuation.date)).toEqual([
      '2025-06-30',
      '2024-03-01',
      '2023-01-01',
    ]);
  });

  it('keeps money and rates exact (0.1 + 0.2 style values round-trip)', async () => {
    const { a } = createTwoPools();
    const id = newId();
    await withPool(a.ctx, (tx) =>
      propertiesRepo.insert(
        tx,
        a.ctx,
        id,
        values({
          purchasePrice: '0.3',
          downPayment: '0.1',
          deedCost: '0.2',
          sellingCostPct: '4.2',
        }),
      ),
    );
    expect(await withPool(a.ctx, (tx) => propertiesRepo.find(tx, a.ctx, id))).toMatchObject({
      purchasePrice: '0.3000',
      downPayment: '0.1000',
      deedCost: '0.2000',
      sellingCostPct: '4.200000',
    });
  });

  it.each([
    ['a down payment above the price', { downPayment: '124000.01' }],
    ['a price of zero', { purchasePrice: '0', downPayment: '0' }],
    ['a negative cost', { imt: '-1' }],
    ['an unknown type', { type: 'castle' }],
    ['a selling cost above 100%', { sellingCostPct: '100.5' }],
    ['an empty name', { name: '' }],
    ['an empty address', { address: '' }],
  ])('the database refuses %s', async (_name, patch) => {
    const { a } = createTwoPools();
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) => propertiesRepo.insert(tx, a.ctx, newId(), values(patch))),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('refuses a share outside (0, 100], a second valuation of a day, and an unknown source', async () => {
    const { a } = createTwoPools();
    const id = newId();
    const ana = await withPool(a.ctx, (tx) => person(tx, a.ctx));
    await withPool(a.ctx, (tx) => propertiesRepo.insert(tx, a.ctx, id, values()));
    for (const sharePct of ['0', '100.1']) {
      expect(
        await failureCodeOf(
          withPool(a.ctx, (tx) =>
            propertiesRepo.replaceHolders(tx, a.ctx, id, [{ holderId: ana.id, sharePct }]),
          ),
        ),
      ).toBe(CHECK_VIOLATION);
    }
    await withPool(a.ctx, (tx) =>
      propertiesRepo.insertValuation(tx, a.ctx, id, {
        date: '2025-01-01',
        value: '1',
        source: 'manual',
      }),
    );
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          propertiesRepo.insertValuation(tx, a.ctx, id, {
            date: '2025-01-01',
            value: '2',
            source: 'estimate',
          }),
        ),
      ),
    ).toBe(UNIQUE_VIOLATION);
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          propertiesRepo.insertValuation(tx, a.ctx, id, {
            date: '2025-02-01',
            value: '2',
            source: 'rumour',
          }),
        ),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('a person who owns part of a property cannot be removed (restrict)', async () => {
    const { a } = createTwoPools();
    const id = newId();
    const ana = await withPool(a.ctx, (tx) => person(tx, a.ctx));
    await withPool(a.ctx, async (tx) => {
      await propertiesRepo.insert(tx, a.ctx, id, values());
      await propertiesRepo.replaceHolders(tx, a.ctx, id, [{ holderId: ana.id, sharePct: '100' }]);
    });
    expect(
      await failureCodeOf(withPool(a.ctx, (tx) => holdersRepo.remove(tx, a.ctx, ana.id))),
    ).toBe('23503');
    expect(await withPool(a.ctx, (tx) => holdersRepo.countReferences(tx, a.ctx, ana.id))).toBe(1);
  });

  it('merging two owners of the same property adds their shares into one row', async () => {
    const { a } = createTwoPools();
    const id = newId();
    const [from, into, other] = await withPool(a.ctx, async (tx) => [
      await person(tx, a.ctx, 'Ana'),
      await person(tx, a.ctx, 'Beto'),
      await person(tx, a.ctx, 'Carla'),
    ]);
    await withPool(a.ctx, async (tx) => {
      await propertiesRepo.insert(tx, a.ctx, id, values());
      await propertiesRepo.replaceHolders(tx, a.ctx, id, [
        { holderId: from.id, sharePct: '30' },
        { holderId: into.id, sharePct: '20' },
        { holderId: other.id, sharePct: '50' },
      ]);
      await holdersRepo.merge(tx, a.ctx, from.id, into.id, []);
    });
    const owners = await withPool(a.ctx, (tx) => propertiesRepo.listHolders(tx, a.ctx, [id]));
    expect(owners).toHaveLength(2);
    expect(owners.find((owner) => owner.holderId === into.id)?.sharePct).toBe('50.000000');
    expect(owners.find((owner) => owner.holderId === other.id)?.sharePct).toBe('50.000000');
  });

  it('merging moves the share of an owner that the target does not share', async () => {
    const { a } = createTwoPools();
    const id = newId();
    const [from, into] = await withPool(a.ctx, async (tx) => [
      await person(tx, a.ctx, 'Ana'),
      await person(tx, a.ctx, 'Beto'),
    ]);
    await withPool(a.ctx, async (tx) => {
      await propertiesRepo.insert(tx, a.ctx, id, values());
      await propertiesRepo.replaceHolders(tx, a.ctx, id, [{ holderId: from.id, sharePct: '100' }]);
      await holdersRepo.merge(tx, a.ctx, from.id, into.id, []);
    });
    expect(await withPool(a.ctx, (tx) => propertiesRepo.listHolders(tx, a.ctx, [id]))).toEqual([
      expect.objectContaining({ holderId: into.id, sharePct: '100.000000' }),
    ]);
  });
});

describe('injection payloads are data', () => {
  it.each([`' OR 1=1 --`, `'; DROP TABLE properties; --`])(
    'stores and reads back %j literally in every text field',
    async (payload) => {
      const { a } = createTwoPools();
      const id = newId();
      await withPool(a.ctx, async (tx) => {
        await propertiesRepo.insert(tx, a.ctx, id, values({ name: payload, address: payload }));
      });
      expect(await withPool(a.ctx, (tx) => propertiesRepo.find(tx, a.ctx, id))).toMatchObject({
        name: payload,
        address: payload,
      });
      expect(await withPool(a.ctx, (tx) => propertiesRepo.list(tx, a.ctx))).toHaveLength(1);
    },
  );

  it('a hostile id finds nothing and breaks nothing (refused as a uuid)', async () => {
    const { a } = createTwoPools();
    await withPool(a.ctx, (tx) => propertiesRepo.insert(tx, a.ctx, newId(), values()));
    expect(
      await failureCodeOf(withPool(a.ctx, (tx) => propertiesRepo.find(tx, a.ctx, `' OR 1=1 --`))),
    ).toBe(PG.invalidText);
    expect(await withPool(a.ctx, (tx) => propertiesRepo.list(tx, a.ctx))).toHaveLength(1);
  });
});

describe('isolation between pools (repository filter and RLS)', () => {
  const seed = async (tx: PoolTx, ctxB: PoolContext) => {
    const ana = await person(tx, ctxB, 'Pessoa B');
    const propertyId = newId();
    await propertiesRepo.insert(tx, ctxB, propertyId, values({ name: 'pool B secret' }));
    await propertiesRepo.replaceHolders(tx, ctxB, propertyId, [
      { holderId: ana.id, sharePct: '100' },
    ]);
    const valuation = await propertiesRepo.insertValuation(tx, ctxB, propertyId, {
      date: '2025-01-01',
      value: '777777',
      source: 'manual',
    });
    return { propertyId, holderId: ana.id, valuationId: valuation.id };
  };
  const snapshot = async (tx: PoolTx, ctxB: PoolContext) => ({
    properties: await propertiesRepo.list(tx, ctxB),
    holders: await propertiesRepo.listHolders(tx, ctxB),
    valuations: await propertiesRepo.listValuations(tx, ctxB),
  });
  type Seed = Awaited<ReturnType<typeof seed>>;
  const check = (run: (tx: PoolTx, ctxA: PoolContext, seeded: Seed) => Promise<unknown>) =>
    expectIsolated({ database, seed, snapshot, run });

  it('list finds nothing of pool B', () => check((tx, ctxA) => propertiesRepo.list(tx, ctxA)));
  it('find finds nothing of pool B', () =>
    check((tx, ctxA, s) => propertiesRepo.find(tx, ctxA, s.propertyId)));
  it('listHolders finds nothing of pool B', () =>
    check((tx, ctxA, s) => propertiesRepo.listHolders(tx, ctxA, [s.propertyId])));
  it('listValuations finds nothing of pool B', () =>
    check((tx, ctxA, s) => propertiesRepo.listValuations(tx, ctxA, [s.propertyId])));
  it('update changes nothing of pool B', () =>
    check((tx, ctxA, s) =>
      propertiesRepo.update(tx, ctxA, s.propertyId, values({ name: 'hijacked' })),
    ));
  it('remove deletes nothing of pool B', () =>
    check((tx, ctxA, s) => propertiesRepo.remove(tx, ctxA, s.propertyId)));
  it('removeValuation deletes nothing of pool B', () =>
    check((tx, ctxA, s) => propertiesRepo.removeValuation(tx, ctxA, s.propertyId, s.valuationId)));
  it('replaceHolders touches nothing of pool B', () =>
    check(async (tx, ctxA, s) => {
      // B's property is not A's: deleting finds nothing and the insert breaks the composite key.
      await propertiesRepo.replaceHolders(tx, ctxA, s.propertyId, []);
      return undefined;
    }));

  it('RLS: a raw select without the pool filter sees only the own pool', async () => {
    const { a, b } = createTwoPools();
    await withPool(a.ctx, (tx) => propertiesRepo.insert(tx, a.ctx, newId(), values()));
    await withPool(b.ctx, (tx) => seed(tx, b.ctx));
    for (const table of ['properties', 'property_holders', 'property_valuations']) {
      const rows = await withPool(a.ctx, (tx) =>
        tx.execute(sql`select pool_id from ${sql.identifier(table)}`),
      );
      expect(rows.rows.every((row) => row['pool_id'] === a.ctx.poolId)).toBe(true);
    }
  });

  it('RLS and composite keys: pool A cannot write into pool B or point at its rows', async () => {
    const { a, b } = createTwoPools();
    const seeded = await withPool(b.ctx, (tx) => seed(tx, b.ctx));
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          tx.execute(
            sql`insert into properties (id, pool_id, name, type, purchase_date, purchase_price)
                values (${newId()}, ${b.ctx.poolId}, 'x', 'land', '2020-01-01', 1)`,
          ),
        ),
      ),
    ).toBe(PG.rlsViolation);
    // A's own property cannot name B's person as an owner.
    const mine = newId();
    await withPool(a.ctx, (tx) => propertiesRepo.insert(tx, a.ctx, mine, values()));
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          propertiesRepo.replaceHolders(tx, a.ctx, mine, [
            { holderId: seeded.holderId, sharePct: '100' },
          ]),
        ),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
    // A valuation cannot be added to B's property through A's context.
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          propertiesRepo.insertValuation(tx, a.ctx, seeded.propertyId, {
            date: '2026-01-01',
            value: '1',
            source: 'manual',
          }),
        ),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });
});
