import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { newId } from '@nestvault/db';

import { createTwoPools, failureCodeOf, openTestDatabase, PG } from './harness';
import { makeProbeRepo, probeRepo, UNPROTECTED_PROBE_SQL, unprotectedProbe } from './probe';

const database = openTestDatabase(2);
const { withPool } = database;

beforeEach(async () => {
  await database.truncateAll();
});

afterAll(async () => {
  await database.close();
});

// Row-level security would hide a missing `where pool_id = ctx.poolId`, so the application-layer
// lock is tested on a twin table with RLS switched off: here only the repository protects the data.
describe('isolation in the application layer alone (where pool_id = ctx.poolId, no RLS)', () => {
  const repo = makeProbeRepo(unprotectedProbe);

  beforeAll(async () => {
    await database.asMigrator((pool) => pool.query(UNPROTECTED_PROBE_SQL));
  });

  afterAll(async () => {
    await database.asMigrator((pool) => pool.query('DROP TABLE IF EXISTS _unprotected_probe'));
  });

  it('list, get, update and remove never touch another pool', async () => {
    const { a, b } = createTwoPools();
    const idA = newId();
    const idB = newId();
    await withPool(a.ctx, (tx) => repo.insert(tx, a.ctx, { id: idA, label: 'a' }));
    await withPool(b.ctx, (tx) => repo.insert(tx, b.ctx, { id: idB, label: 'b' }));

    expect((await withPool(a.ctx, (tx) => repo.list(tx, a.ctx))).map((r) => r.id)).toEqual([idA]);
    expect(await withPool(a.ctx, (tx) => repo.get(tx, a.ctx, idB))).toBeUndefined();
    expect(await withPool(a.ctx, (tx) => repo.update(tx, a.ctx, idB, 'hijacked'))).toEqual([]);
    expect(await withPool(a.ctx, (tx) => repo.remove(tx, a.ctx, idB))).toEqual([]);
    expect((await withPool(b.ctx, (tx) => repo.get(tx, b.ctx, idB)))?.label).toBe('b');
  });

  it('proves the twin really has no RLS (so the test above is meaningful)', async () => {
    const { a, b } = createTwoPools();
    await withPool(a.ctx, (tx) => repo.insert(tx, a.ctx, { id: newId(), label: 'a' }));
    await withPool(b.ctx, (tx) => repo.insert(tx, b.ctx, { id: newId(), label: 'b' }));
    const rows = await withPool(a.ctx, (tx) => tx.select().from(unprotectedProbe));
    expect(rows).toHaveLength(2);
  });
});

describe('isolation in both layers on the protected table', () => {
  it('list, get, update and remove never touch another pool', async () => {
    const { a, b } = createTwoPools();
    const idA = newId();
    const idB = newId();
    await withPool(a.ctx, (tx) => probeRepo.insert(tx, a.ctx, { id: idA, label: 'a' }));
    await withPool(b.ctx, (tx) => probeRepo.insert(tx, b.ctx, { id: idB, label: 'b' }));

    expect((await withPool(a.ctx, (tx) => probeRepo.list(tx, a.ctx))).map((r) => r.id)).toEqual([
      idA,
    ]);
    expect(await withPool(a.ctx, (tx) => probeRepo.get(tx, a.ctx, idB))).toBeUndefined();
    expect(await withPool(a.ctx, (tx) => probeRepo.update(tx, a.ctx, idB, 'hijacked'))).toEqual([]);
    expect(await withPool(a.ctx, (tx) => probeRepo.remove(tx, a.ctx, idB))).toEqual([]);

    const untouched = await withPool(b.ctx, (tx) => probeRepo.get(tx, b.ctx, idB));
    expect(untouched?.label).toBe('b');
  });

  it('takes the pool from the context, never from the input', async () => {
    const { a, b } = createTwoPools();
    const row = await withPool(a.ctx, (tx) =>
      // A caller trying to smuggle a pool id in is ignored: the repository builds the row itself.
      probeRepo.insert(tx, a.ctx, { id: newId(), label: 'x', poolId: b.poolId } as never),
    );
    expect(row?.poolId).toBe(a.poolId);
  });
});

describe('SQL injection payloads are data', () => {
  const payloads = [
    "' OR 1=1 --",
    "'; DROP TABLE _isolation_probe; --",
    "Robert'); DROP TABLE _isolation_probe;--",
    '" OR ""="',
    "\\'; select pg_sleep(5); --",
    '%',
  ];

  it.each(payloads)('stores and returns %j literally and the table survives', async (payload) => {
    const { a, b } = createTwoPools();
    const id = newId();
    await withPool(a.ctx, (tx) => probeRepo.insert(tx, a.ctx, { id, label: payload }));
    await withPool(b.ctx, (tx) => probeRepo.insert(tx, b.ctx, { id: newId(), label: 'b-secret' }));

    const row = await withPool(a.ctx, (tx) => probeRepo.get(tx, a.ctx, id));
    expect(row?.label).toBe(payload);

    const updated = await withPool(a.ctx, (tx) => probeRepo.update(tx, a.ctx, id, `${payload}!`));
    expect(updated[0]?.label).toBe(`${payload}!`);

    // The payload as an id lookup: still no rows, still no other pool's rows.
    expect(await failureCodeOf(withPool(a.ctx, (tx) => probeRepo.get(tx, a.ctx, payload)))).toBe(
      PG.invalidText,
    );
    expect(await withPool(a.ctx, (tx) => probeRepo.list(tx, a.ctx))).toHaveLength(1);

    const table = await database.app.pool.query(
      "select to_regclass('public._isolation_probe') as t",
    );
    expect(table.rows[0]).toEqual({ t: '_isolation_probe' });
  });
});

describe('money and quantity precision', () => {
  it('round-trips decimals exactly as strings (no float rounding)', async () => {
    const { a } = createTwoPools();
    const id = newId();
    await withPool(a.ctx, (tx) =>
      probeRepo.insert(tx, a.ctx, { id, label: 'precision', amount: '0.1', qty: '0.12345678' }),
    );
    const row = await withPool(a.ctx, (tx) => probeRepo.get(tx, a.ctx, id));
    expect(row?.amount).toBe('0.1000');
    expect(row?.qty).toBe('0.12345678');
    expect(typeof row?.amount).toBe('string');
  });

  it('keeps 0.1 and 0.2 exact and sums them in the database without drift', async () => {
    const { a } = createTwoPools();
    await withPool(a.ctx, (tx) =>
      probeRepo.insert(tx, a.ctx, { id: newId(), label: '1', amount: '0.1' }),
    );
    await withPool(a.ctx, (tx) =>
      probeRepo.insert(tx, a.ctx, { id: newId(), label: '2', amount: '0.2' }),
    );
    // Summed in the database, inside the pool: even the table owner is subject to FORCE RLS.
    const total = await withPool(a.ctx, (tx) =>
      tx.execute<{ total: string }>(sql`select sum(amount)::text as total from _isolation_probe`),
    );
    expect(total.rows[0]?.total).toBe('0.3000');
    expect(0.1 + 0.2).not.toBe(0.3); // the float the column helpers exist to avoid
  });

  it('holds the largest money value and rejects one digit more', async () => {
    const { a } = createTwoPools();
    const largest = '99999999999999.9999';
    const id = newId();
    await withPool(a.ctx, (tx) =>
      probeRepo.insert(tx, a.ctx, { id, label: 'max', amount: largest }),
    );
    expect((await withPool(a.ctx, (tx) => probeRepo.get(tx, a.ctx, id)))?.amount).toBe(largest);
    expect(
      await failureCodeOf(
        withPool(a.ctx, (tx) =>
          probeRepo.insert(tx, a.ctx, {
            id: newId(),
            label: 'overflow',
            amount: '100000000000000',
          }),
        ),
      ),
    ).toBe(PG.numericOverflow);
  });
});
