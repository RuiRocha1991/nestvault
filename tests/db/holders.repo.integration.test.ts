import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { holdersRepo, newId, type HolderValues } from '@nestvault/db';

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
const UNIQUE_VIOLATION = '23505';

const values = (overrides: Partial<HolderValues> = {}): HolderValues => ({
  name: 'Ana',
  color: '#9D6BFF',
  aliases: ['ANA SILVA'],
  userId: null,
  ...overrides,
});

describe('holders repository', () => {
  it('inserts, finds, lists, updates and removes inside the pool', async () => {
    const { a } = createTwoPools();
    const id = newId();
    const created = await withPool(a.ctx, (tx) => holdersRepo.insert(tx, a.ctx, id, values()));
    expect(created).toMatchObject({ id, poolId: a.poolId, name: 'Ana', aliases: ['ANA SILVA'] });

    expect(await withPool(a.ctx, (tx) => holdersRepo.list(tx, a.ctx))).toHaveLength(1);
    expect((await withPool(a.ctx, (tx) => holdersRepo.find(tx, a.ctx, id)))?.id).toBe(id);

    const updated = await withPool(a.ctx, (tx) =>
      holdersRepo.update(tx, a.ctx, id, values({ name: 'Ana Maria', aliases: [] })),
    );
    expect(updated).toMatchObject({ name: 'Ana Maria', aliases: [] });

    expect(await withPool(a.ctx, (tx) => holdersRepo.remove(tx, a.ctx, id))).toBe(true);
    expect(await withPool(a.ctx, (tx) => holdersRepo.find(tx, a.ctx, id))).toBeUndefined();
  });

  it('counts no references until accounts exist (NES-39)', async () => {
    const { a } = createTwoPools();
    expect(await withPool(a.ctx, (tx) => holdersRepo.countReferences(tx, a.ctx, newId()))).toBe(0);
  });
});

describe('isolation between pools (repository filter and RLS)', () => {
  const seed = (
    tx: Parameters<typeof holdersRepo.list>[0],
    ctxB: Parameters<typeof holdersRepo.list>[1],
  ) => holdersRepo.insert(tx, ctxB, newId(), values({ name: 'pool B secret' })).then((r) => r.id);
  const snapshot = (
    tx: Parameters<typeof holdersRepo.list>[0],
    ctxB: Parameters<typeof holdersRepo.list>[1],
  ) => holdersRepo.list(tx, ctxB);

  it('list finds nothing of pool B', () =>
    expectIsolated({ database, seed, snapshot, run: (tx, ctxA) => holdersRepo.list(tx, ctxA) }));

  it('find finds nothing of pool B', () =>
    expectIsolated({
      database,
      seed,
      snapshot,
      run: (tx, ctxA, id) => holdersRepo.find(tx, ctxA, id),
    }));

  it('update changes nothing of pool B', () =>
    expectIsolated({
      database,
      seed,
      snapshot,
      run: (tx, ctxA, id) => holdersRepo.update(tx, ctxA, id, values({ name: 'hijacked' })),
    }));

  it('remove deletes nothing of pool B', () =>
    expectIsolated({
      database,
      seed,
      snapshot,
      run: (tx, ctxA, id) => holdersRepo.remove(tx, ctxA, id),
    }));

  it('shows only the pool rows to a select without a where, and refuses a row for another pool', async () => {
    const { a, b } = createTwoPools();
    await withPool(a.ctx, (tx) => holdersRepo.insert(tx, a.ctx, newId(), values()));
    await withPool(b.ctx, (tx) => holdersRepo.insert(tx, b.ctx, newId(), values({ name: 'B' })));

    const seen = await withPool(a.ctx, (tx) => tx.execute(sql`select pool_id from holders`));
    expect(seen.rows).toEqual([{ pool_id: a.poolId }]);

    const code = await failureCodeOf(
      withPool(a.ctx, (tx) =>
        tx.execute(
          sql`insert into holders (id, pool_id, name, color) values (${newId()}, ${b.poolId}, 'x', '#000000')`,
        ),
      ),
    );
    expect(code).toBe(PG.rlsViolation);
  });

  it('sees nothing outside withPool', async () => {
    const { a } = createTwoPools();
    await withPool(a.ctx, (tx) => holdersRepo.insert(tx, a.ctx, newId(), values()));
    expect((await database.app.pool.query('select * from holders')).rows).toEqual([]);
  });
});

describe('constraints', () => {
  it('stores SQL injection payloads in name and aliases literally', async () => {
    const { a } = createTwoPools();
    const payloads = ["' OR 1=1 --", "'; DROP TABLE holders; --"];
    const id = newId();
    await withPool(a.ctx, (tx) =>
      holdersRepo.insert(tx, a.ctx, id, values({ name: payloads[0] ?? '', aliases: payloads })),
    );
    const row = await withPool(a.ctx, (tx) => holdersRepo.find(tx, a.ctx, id));
    expect(row).toMatchObject({ name: payloads[0], aliases: payloads });
    expect(await withPool(a.ctx, (tx) => holdersRepo.list(tx, a.ctx))).toHaveLength(1);
  });

  it('rejects a bad colour, an empty name and more than 10 aliases', async () => {
    const { a } = createTwoPools();
    const insert = (data: HolderValues) =>
      failureCodeOf(withPool(a.ctx, (tx) => holdersRepo.insert(tx, a.ctx, newId(), data)));
    expect(await insert(values({ color: 'red' }))).toBe(CHECK_VIOLATION);
    expect(await insert(values({ name: '' }))).toBe(CHECK_VIOLATION);
    expect(
      await insert(values({ aliases: Array.from({ length: 11 }, (_, i) => `ALIAS ${i}`) })),
    ).toBe(CHECK_VIOLATION);
  });

  it('links a user to at most one holder per pool, and the same user may be a holder in another pool', async () => {
    const { a, b } = createTwoPools();
    const userId = newId();
    await withPool(a.ctx, (tx) => holdersRepo.insert(tx, a.ctx, newId(), values({ userId })));
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) => holdersRepo.insert(tx, a.ctx, newId(), values({ userId }))),
      ),
    ).toBe(UNIQUE_VIOLATION);
    await withPool(b.ctx, (tx) => holdersRepo.insert(tx, b.ctx, newId(), values({ userId })));
  });
});
