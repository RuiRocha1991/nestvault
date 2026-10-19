import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  categoriesRepo,
  categorySettingsRepo,
  GLOBAL_CATEGORIES,
  newId,
  type PoolContext,
  type PoolTx,
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
const UNIQUE_VIOLATION = '23505';

const own = (tx: PoolTx, ctx: PoolContext, name = 'Cantina', kind = 'expense') =>
  categoriesRepo.insert(tx, ctx, newId(), { name, kind, color: '#112233' });

describe('the global catalogue (ADR 0004)', () => {
  it('is seeded once with the 25 defaults and every pool sees them without a copy', async () => {
    const { a, b } = createTwoPools();
    const seenByA = await withPool(a.ctx, (tx) => categoriesRepo.list(tx, a.ctx));
    const seenByB = await withPool(b.ctx, (tx) => categoriesRepo.list(tx, b.ctx));
    expect(seenByA).toHaveLength(25);
    expect(seenByB.map((row) => row.id)).toEqual(seenByA.map((row) => row.id));
    expect(seenByA.every((row) => row.poolId === null && row.name === null)).toBe(true);
    expect(
      seenByA
        .map((row) => ({ systemKey: row.systemKey, kind: row.kind, color: row.color }))
        .sort((x, y) => (x.systemKey ?? '').localeCompare(y.systemKey ?? '')),
    ).toEqual([...GLOBAL_CATEGORIES].sort((x, y) => x.systemKey.localeCompare(y.systemKey)));
    const stored = await database.app.pool.query('select count(*)::int as n from categories');
    expect(stored.rows).toEqual([{ n: 25 }]);
  });

  it('cannot be changed or removed through a pool context', async () => {
    const { a } = createTwoPools();
    const [global] = await withPool(a.ctx, (tx) => categoriesRepo.list(tx, a.ctx));
    const id = global?.id ?? '';
    expect(
      await withPool(a.ctx, (tx) =>
        categoriesRepo.update(tx, a.ctx, id, {
          name: 'hijacked',
          kind: 'income',
          color: '#000000',
        }),
      ),
    ).toBeUndefined();
    expect(await withPool(a.ctx, (tx) => categoriesRepo.remove(tx, a.ctx, id))).toBe(false);
    expect(await withPool(a.ctx, (tx) => categoriesRepo.find(tx, a.ctx, id))).toEqual(global);
  });

  it('refuses a raw write to a global row at the database: update, delete and "stealing" it', async () => {
    const { a } = createTwoPools();
    const before = await withPool(a.ctx, (tx) => categoriesRepo.list(tx, a.ctx));
    const touched = await withPool(a.ctx, async (tx) => {
      const rename = await tx.execute(
        sql`update categories set kind = 'income' where pool_id is null`,
      );
      const steal = await tx.execute(
        sql`update categories set pool_id = ${a.poolId}, name = 'mine', system_key = null where pool_id is null`,
      );
      const remove = await tx.execute(sql`delete from categories where pool_id is null`);
      return [rename.rowCount, steal.rowCount, remove.rowCount];
    });
    expect(touched).toEqual([0, 0, 0]);
    expect(await withPool(a.ctx, (tx) => categoriesRepo.list(tx, a.ctx))).toEqual(before);
  });

  it('refuses a new global row from a pool (pool_id null) and a row for another pool', async () => {
    const { a, b } = createTwoPools();
    const insert = (poolId: string | null, systemKey: string | null, name: string | null) =>
      failureCodeOf(
        withPool(a.ctx, (tx) =>
          tx.execute(
            sql`insert into categories (id, pool_id, system_key, name, kind, color) values (${newId()}, ${poolId}, ${systemKey}, ${name}, 'expense', '#112233')`,
          ),
        ),
      );
    expect(await insert(null, 'sneaky', null)).toBe(PG.rlsViolation);
    expect(await insert(b.poolId, null, 'foreign')).toBe(PG.rlsViolation);
  });

  it('shows a pool only the global rows and its own to a select without a where', async () => {
    const { a, b } = createTwoPools();
    await withPool(a.ctx, (tx) => own(tx, a.ctx, 'só da A'));
    await withPool(b.ctx, (tx) => own(tx, b.ctx, 'só da B'));
    const seen = await withPool(a.ctx, (tx) =>
      tx.execute(sql`select pool_id, name from categories`),
    );
    expect(seen.rows).toHaveLength(26);
    expect(seen.rows.filter((row) => row.pool_id !== null)).toEqual([
      { pool_id: a.poolId, name: 'só da A' },
    ]);
    // Outside withPool nothing of any pool is visible, only the public catalogue.
    const outside = await database.app.pool.query<{ pool_id: string | null }>(
      'select pool_id from categories',
    );
    expect(outside.rows.every((row) => row.pool_id === null)).toBe(true);
  });
});

describe('categories of a pool', () => {
  it('inserts, finds, updates and removes its own, invisible to every other pool', async () => {
    const { a, b } = createTwoPools();
    const created = await withPool(a.ctx, (tx) => own(tx, a.ctx));
    expect(created).toMatchObject({ poolId: a.poolId, name: 'Cantina', systemKey: null });
    expect(
      await withPool(b.ctx, (tx) => categoriesRepo.find(tx, b.ctx, created.id)),
    ).toBeUndefined();
    expect(await withPool(b.ctx, (tx) => categoriesRepo.list(tx, b.ctx))).toHaveLength(25);

    const updated = await withPool(a.ctx, (tx) =>
      categoriesRepo.update(tx, a.ctx, created.id, {
        name: 'Refeitório',
        kind: 'income',
        color: '#445566',
      }),
    );
    expect(updated).toMatchObject({ name: 'Refeitório', kind: 'income', color: '#445566' });
    expect(await withPool(a.ctx, (tx) => categoriesRepo.remove(tx, a.ctx, created.id))).toBe(true);
    expect(await withPool(a.ctx, (tx) => categoriesRepo.list(tx, a.ctx))).toHaveLength(25);
  });

  it('counts no uses and reassigns nothing until the tables exist (NES-44)', async () => {
    const { a } = createTwoPools();
    expect(await withPool(a.ctx, (tx) => categoriesRepo.countReferences(tx, a.ctx, newId()))).toBe(
      0,
    );
    await withPool(a.ctx, (tx) => categoriesRepo.reassign(tx, a.ctx, newId(), newId()));
  });

  it('stores SQL injection payloads in the name literally', async () => {
    const { a } = createTwoPools();
    const payload = "'; DROP TABLE categories; --";
    await withPool(a.ctx, (tx) => own(tx, a.ctx, payload));
    await withPool(a.ctx, (tx) => own(tx, a.ctx, "' OR 1=1 --"));
    const names = (await withPool(a.ctx, (tx) => categoriesRepo.list(tx, a.ctx)))
      .map((row) => row.name)
      .filter((name) => name !== null);
    expect(names.sort()).toEqual([payload, "' OR 1=1 --"].sort());
    expect(await withPool(a.ctx, (tx) => categoriesRepo.list(tx, a.ctx))).toHaveLength(27);
  });

  it('keeps a name unique inside a pool only', async () => {
    const { a, b } = createTwoPools();
    await withPool(a.ctx, (tx) => own(tx, a.ctx));
    expect(await failureCodeOf(withPool(a.ctx, (tx) => own(tx, a.ctx)))).toBe(UNIQUE_VIOLATION);
    await withPool(b.ctx, (tx) => own(tx, b.ctx));
  });

  it('rejects a row that is neither global nor a named pool category, and bad kind or colour', async () => {
    const { a } = createTwoPools();
    const raw = (statement: ReturnType<typeof sql>) =>
      failureCodeOf(withPool(a.ctx, (tx) => tx.execute(statement)));
    // A pool row with a system key, a pool row without a name:
    expect(
      await raw(
        sql`insert into categories (id, pool_id, system_key, name, kind, color) values (${newId()}, ${a.poolId}, 'groceries', 'x', 'expense', '#112233')`,
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await raw(
        sql`insert into categories (id, pool_id, kind, color) values (${newId()}, ${a.poolId}, 'expense', '#112233')`,
      ),
    ).toBe(CHECK_VIOLATION);
    expect(await failureCodeOf(withPool(a.ctx, (tx) => own(tx, a.ctx, 'x', 'gift')))).toBe(
      CHECK_VIOLATION,
    );
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          categoriesRepo.insert(tx, a.ctx, newId(), { name: 'y', kind: 'expense', color: 'red' }),
        ),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(await failureCodeOf(withPool(a.ctx, (tx) => own(tx, a.ctx, '')))).toBe(CHECK_VIOLATION);
  });
});

describe('isolation between pools (repository filter and RLS)', () => {
  const seed = async (tx: PoolTx, ctxB: PoolContext) => {
    const created = await own(tx, ctxB, 'pool B secret');
    await categorySettingsRepo.upsert(tx, ctxB, created.id, {
      monthlyBudget: '99',
      colorOverride: '#ABCDEF',
      hidden: true,
    });
    return { id: created.id };
  };
  const snapshot = async (tx: PoolTx, ctxB: PoolContext) => ({
    categories: await categoriesRepo.list(tx, ctxB),
    settings: await categorySettingsRepo.list(tx, ctxB),
  });
  type Seed = Awaited<ReturnType<typeof seed>>;
  const check = (run: (tx: PoolTx, ctxA: PoolContext, seeded: Seed) => Promise<unknown>) =>
    expectIsolated({ database, seed, snapshot, run });

  it('categories: find finds nothing of pool B', () =>
    check((tx, ctxA, s) => categoriesRepo.find(tx, ctxA, s.id)));
  it('categories: update changes nothing of pool B', () =>
    check((tx, ctxA, s) =>
      categoriesRepo.update(tx, ctxA, s.id, { name: 'hijacked', kind: 'income', color: '#000000' }),
    ));
  it('categories: remove deletes nothing of pool B', () =>
    check((tx, ctxA, s) => categoriesRepo.remove(tx, ctxA, s.id)));
  it('settings: find finds nothing of pool B', () =>
    check((tx, ctxA, s) => categorySettingsRepo.find(tx, ctxA, s.id)));

  it('settings: list shows only the pool’s own rows', async () => {
    const { a, b } = createTwoPools();
    await withPool(b.ctx, (tx) => seed(tx, b.ctx));
    expect(await withPool(a.ctx, (tx) => categorySettingsRepo.list(tx, a.ctx))).toEqual([]);
  });

  it('settings: upsert as pool A never touches the row of pool B for the same global category', async () => {
    const { a, b } = createTwoPools();
    const [global] = await withPool(a.ctx, (tx) => categoriesRepo.list(tx, a.ctx));
    const id = global?.id ?? '';
    await withPool(b.ctx, (tx) =>
      categorySettingsRepo.upsert(tx, b.ctx, id, {
        monthlyBudget: '70',
        colorOverride: null,
        hidden: false,
      }),
    );
    await withPool(a.ctx, (tx) =>
      categorySettingsRepo.upsert(tx, a.ctx, id, {
        monthlyBudget: '10',
        colorOverride: null,
        hidden: true,
      }),
    );
    expect(await withPool(a.ctx, (tx) => categorySettingsRepo.find(tx, a.ctx, id))).toMatchObject({
      monthlyBudget: '10.0000',
      hidden: true,
    });
    expect(await withPool(b.ctx, (tx) => categorySettingsRepo.find(tx, b.ctx, id))).toMatchObject({
      monthlyBudget: '70.0000',
      hidden: false,
    });
  });

  it('settings: a pool cannot point at another pool’s category, even with the foreign key satisfied', async () => {
    const { a, b } = createTwoPools();
    const theirs = await withPool(b.ctx, (tx) => own(tx, b.ctx, 'só da B'));
    const code = await failureCodeOf(
      withPool(a.ctx, (tx) =>
        categorySettingsRepo.upsert(tx, a.ctx, theirs.id, {
          monthlyBudget: '1',
          colorOverride: null,
          hidden: false,
        }),
      ),
    );
    expect(code).toBe(PG.rlsViolation);
    expect(await withPool(b.ctx, (tx) => categorySettingsRepo.list(tx, b.ctx))).toEqual([]);
  });

  it('settings: refuses a row for another pool and shows nothing outside withPool', async () => {
    const { a, b } = createTwoPools();
    const [global] = await withPool(a.ctx, (tx) => categoriesRepo.list(tx, a.ctx));
    const code = await failureCodeOf(
      withPool(a.ctx, (tx) =>
        tx.execute(
          sql`insert into pool_category_settings (pool_id, category_id) values (${b.poolId}, ${global?.id ?? ''})`,
        ),
      ),
    );
    expect(code).toBe(PG.rlsViolation);
    await withPool(a.ctx, (tx) =>
      categorySettingsRepo.upsert(tx, a.ctx, global?.id ?? '', {
        monthlyBudget: null,
        colorOverride: null,
        hidden: true,
      }),
    );
    expect((await database.app.pool.query('select * from pool_category_settings')).rows).toEqual(
      [],
    );
  });
});

describe('category settings', () => {
  it('creates and replaces the one row per pool and category, with exact decimals', async () => {
    const { a } = createTwoPools();
    const created = await withPool(a.ctx, (tx) => own(tx, a.ctx));
    const first = await withPool(a.ctx, (tx) =>
      categorySettingsRepo.upsert(tx, a.ctx, created.id, {
        monthlyBudget: '0.1',
        colorOverride: '#AABBCC',
        hidden: false,
      }),
    );
    expect(first).toMatchObject({
      poolId: a.poolId,
      monthlyBudget: '0.1000',
      colorOverride: '#AABBCC',
    });
    const second = await withPool(a.ctx, (tx) =>
      categorySettingsRepo.upsert(tx, a.ctx, created.id, {
        monthlyBudget: null,
        colorOverride: null,
        hidden: true,
      }),
    );
    expect(second).toMatchObject({ monthlyBudget: null, colorOverride: null, hidden: true });
    expect(await withPool(a.ctx, (tx) => categorySettingsRepo.list(tx, a.ctx))).toHaveLength(1);
  });

  it('goes with the category when a pool deletes it', async () => {
    const { a } = createTwoPools();
    const created = await withPool(a.ctx, (tx) => own(tx, a.ctx));
    await withPool(a.ctx, (tx) =>
      categorySettingsRepo.upsert(tx, a.ctx, created.id, {
        monthlyBudget: '5',
        colorOverride: null,
        hidden: false,
      }),
    );
    await withPool(a.ctx, (tx) => categoriesRepo.remove(tx, a.ctx, created.id));
    expect(await withPool(a.ctx, (tx) => categorySettingsRepo.list(tx, a.ctx))).toEqual([]);
  });

  it('rejects a negative budget, a bad colour and a category that does not exist', async () => {
    const { a } = createTwoPools();
    const created = await withPool(a.ctx, (tx) => own(tx, a.ctx));
    const save = (categoryId: string, monthlyBudget: string | null, colorOverride: string | null) =>
      failureCodeOf(
        withPool(a.ctx, (tx) =>
          categorySettingsRepo.upsert(tx, a.ctx, categoryId, {
            monthlyBudget,
            colorOverride,
            hidden: false,
          }),
        ),
      );
    expect(await save(created.id, '-1', null)).toBe(CHECK_VIOLATION);
    expect(await save(created.id, null, 'blue')).toBe(CHECK_VIOLATION);
    expect(await save(newId(), null, null)).toBe(PG.rlsViolation);
  });
});
