import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { applyPoolSetting, lazyOnce, newId } from '@nestvault/db';

import { createTwoPools, failureCodeOf, openTestDatabase, PG } from './harness';
import { isolationProbe, probeRepo, probeUnfiltered } from './probe';

// One connection only, so every test reuses the same session: a setting that leaked from one
// transaction to the next would show up immediately.
const database = openTestDatabase(1);
const { withPool } = database;

beforeEach(async () => {
  await database.truncateAll();
});

afterAll(async () => {
  await database.close();
});

describe('row-level security through withPool', () => {
  it('returns no rows when the query runs outside withPool', async () => {
    const { a } = createTwoPools();
    await withPool(a.ctx, (tx) => probeRepo.insert(tx, a.ctx, { id: newId(), label: 'a-row' }));

    // Same table, same user, but no pool setting: the policy matches nothing.
    const rows = await database.app.db.select().from(isolationProbe);
    expect(rows).toEqual([]);
  });

  it('shows only the pool rows to a select without a where', async () => {
    const { a, b } = createTwoPools();
    await withPool(a.ctx, (tx) => probeRepo.insert(tx, a.ctx, { id: newId(), label: 'a-1' }));
    await withPool(a.ctx, (tx) => probeRepo.insert(tx, a.ctx, { id: newId(), label: 'a-2' }));
    await withPool(b.ctx, (tx) => probeRepo.insert(tx, b.ctx, { id: newId(), label: 'b-1' }));

    const seenByA = await withPool(a.ctx, (tx) => probeUnfiltered.list(tx));
    expect(seenByA.map((row) => row.label).sort()).toEqual(['a-1', 'a-2']);
    expect(seenByA.every((row) => row.poolId === a.poolId)).toBe(true);

    const seenByB = await withPool(b.ctx, (tx) => probeUnfiltered.list(tx));
    expect(seenByB.map((row) => row.label)).toEqual(['b-1']);
  });

  it('rejects inserting a row for another pool (WITH CHECK)', async () => {
    const { a, b } = createTwoPools();
    const code = await failureCodeOf(
      withPool(a.ctx, (tx) =>
        probeUnfiltered.insertForPool(tx, { id: newId(), poolId: b.poolId, label: 'forged' }),
      ),
    );
    expect(code).toBe(PG.rlsViolation);

    expect(await withPool(b.ctx, (tx) => probeUnfiltered.list(tx))).toEqual([]);
  });

  it('cannot move a row to another pool with an update', async () => {
    const { a, b } = createTwoPools();
    const id = newId();
    await withPool(a.ctx, (tx) => probeRepo.insert(tx, a.ctx, { id, label: 'mine' }));
    const code = await failureCodeOf(
      withPool(a.ctx, (tx) =>
        tx.execute(sql`update _isolation_probe set pool_id = ${b.poolId} where id = ${id}`),
      ),
    );
    expect(code).toBe(PG.rlsViolation);
  });

  it('does not leak the pool setting to the next user of the same connection', async () => {
    const { a } = createTwoPools();
    await withPool(a.ctx, (tx) => probeRepo.insert(tx, a.ctx, { id: newId(), label: 'a-row' }));

    // The transaction is over and the (only) connection is reused: the setting is now an empty
    // string. The policy must treat it as "no pool", not fail with an invalid uuid.
    const setting = await database.app.pool.query(
      "select current_setting('app.pool_id', true) as v",
    );
    expect(setting.rows[0]).toEqual({ v: '' });
    const rows = await database.app.pool.query('select * from _isolation_probe');
    expect(rows.rows).toEqual([]);
  });

  it('runs each withPool in its own transaction and rolls back on error', async () => {
    const { a } = createTwoPools();
    await expect(
      withPool(a.ctx, async (tx) => {
        await probeRepo.insert(tx, a.ctx, { id: newId(), label: 'will-roll-back' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await withPool(a.ctx, (tx) => probeRepo.list(tx, a.ctx))).toEqual([]);
  });
});

describe('the application database role', () => {
  it('is app_rw: not a superuser, no BYPASSRLS, not the owner of the tables', async () => {
    const { a } = createTwoPools();
    const [role] = (
      await withPool(a.ctx, (tx) =>
        tx.execute<{ name: string; rolsuper: boolean; rolbypassrls: boolean }>(sql`
          select current_user as name, rolsuper, rolbypassrls from pg_roles where rolname = current_user
        `),
      )
    ).rows;
    expect(role).toEqual({ name: 'app_rw', rolsuper: false, rolbypassrls: false });

    const owner = (
      await withPool(a.ctx, (tx) =>
        tx.execute<{ owner: string }>(sql`
          select tableowner as owner from pg_tables where tablename = '_isolation_probe'
        `),
      )
    ).rows[0];
    expect(owner?.owner).toBe('nestvault_migrator');
  });
});

describe('set_config is a bound parameter (SQL injection)', () => {
  const payloads = [
    "x'); DROP TABLE _isolation_probe; --",
    "' OR 1=1 --",
    "00000000-0000-0000-0000-000000000000'; select pg_sleep(5); --",
    '"; drop schema public cascade; --',
  ];

  it.each(payloads)('stores %j as data and leaves the schema alone', async (payload) => {
    const stored = await database.app.db.transaction(async (tx) => {
      await applyPoolSetting(tx, payload);
      const result = await tx.execute<{ v: string }>(
        sql`select current_setting('app.pool_id') as v`,
      );
      return result.rows[0]?.v;
    });
    expect(stored).toBe(payload);

    const table = await database.app.pool.query(
      "select to_regclass('public._isolation_probe') as t",
    );
    expect(table.rows[0]).toEqual({ t: '_isolation_probe' });
  });

  it('a malicious value never matches a pool: the cast fails closed instead of widening access', async () => {
    const { a } = createTwoPools();
    await withPool(a.ctx, (tx) => probeRepo.insert(tx, a.ctx, { id: newId(), label: 'safe' }));
    const code = await failureCodeOf(
      database.app.db.transaction(async (tx) => {
        await applyPoolSetting(tx, "' OR 1=1 --");
        return probeUnfiltered.list(tx);
      }),
    );
    expect(code).toBe(PG.invalidText);
  });
});

describe('lazyOnce (the shared connection pool is created on first use)', () => {
  it('runs the initializer once and shares its result', async () => {
    let calls = 0;
    const get = lazyOnce(() => Promise.resolve(++calls));
    expect(await Promise.all([get(), get()])).toEqual([1, 1]);
    expect(await get()).toBe(1);
  });

  it('does not cache a failure: the next call tries again', async () => {
    let calls = 0;
    const get = lazyOnce(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('env invalid')) : Promise.resolve('ready');
    });
    await expect(get()).rejects.toThrow('env invalid');
    await expect(get()).resolves.toBe('ready');
    expect(calls).toBe(2);
  });
});
