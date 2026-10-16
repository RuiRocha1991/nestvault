import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { newId } from '@nestvault/db';

import { expectIsolated, isEmptyResult } from '../support/expect-isolated';

import { openTestDatabase, pgErrorCode, PG } from './harness';
import {
  makeProbeRepo,
  probeRepo,
  probeUnfiltered,
  UNPROTECTED_PROBE_SQL,
  unprotectedProbe,
} from './probe';

// `expectIsolated(repoFn)` (NES-30) applied to the probe repository, the model for every repository
// of the `app` database, and proven to fail when a function ignores the pool.

const database = openTestDatabase(2);

beforeEach(async () => {
  await database.truncateAll();
});

afterAll(async () => {
  await database.close();
});

type Tx = Parameters<typeof probeRepo.list>[0];

const seedRow =
  (repo: ReturnType<typeof makeProbeRepo>) =>
  (tx: Parameters<typeof probeRepo.list>[0], ctxB: Parameters<typeof probeRepo.list>[1]) =>
    repo.insert(tx, ctxB, { id: newId(), label: 'pool B secret' }).then((row) => row?.id ?? '');

describe('a repository that filters by pool_id and runs under RLS', () => {
  const snapshot = (
    tx: Parameters<typeof probeRepo.list>[0],
    ctxB: Parameters<typeof probeRepo.list>[1],
  ) => probeRepo.list(tx, ctxB);

  it('get finds nothing of another pool', async () => {
    await expectIsolated({
      database,
      seed: seedRow(probeRepo),
      run: (tx, ctxA, id) => probeRepo.get(tx, ctxA, id),
      snapshot,
    });
  });

  it('list returns none of its rows', async () => {
    await expectIsolated({
      database,
      seed: seedRow(probeRepo),
      run: (tx, ctxA) => probeRepo.list(tx, ctxA),
      snapshot,
    });
  });

  it('update changes nothing of another pool', async () => {
    await expectIsolated({
      database,
      seed: seedRow(probeRepo),
      run: (tx, ctxA, id) => probeRepo.update(tx, ctxA, id, 'hijacked'),
      snapshot,
    });
  });

  it('remove deletes nothing of another pool', async () => {
    await expectIsolated({
      database,
      seed: seedRow(probeRepo),
      run: (tx, ctxA, id) => probeRepo.remove(tx, ctxA, id),
      snapshot,
    });
  });

  it('a function with no pool filter is still held back by RLS', async () => {
    await expectIsolated({
      database,
      seed: seedRow(probeRepo),
      run: (tx) => probeUnfiltered.list(tx),
      snapshot,
    });
  });

  it('injection payloads used as the id are data, never a way to reach another pool', async () => {
    await expectIsolated({
      database,
      seed: seedRow(probeRepo),
      run: (tx, ctxA) => probeRepo.get(tx, ctxA, "' OR 1=1 --"),
      snapshot,
      outcome: 'rejects', // not a uuid: refused by the database, not matched against B
      refusal: (error) => pgErrorCode(error) === PG.invalidText,
    });
  });
});

describe('the helper fails when a repository function ignores the pool', () => {
  const leaky = {
    get: (tx: Parameters<typeof probeRepo.list>[0], id: string) =>
      tx.select().from(unprotectedProbe).where(eq(unprotectedProbe.id, id)),
    update: (tx: Parameters<typeof probeRepo.list>[0], id: string) =>
      tx
        .update(unprotectedProbe)
        .set({ label: 'hijacked' })
        .where(eq(unprotectedProbe.id, id))
        .returning(),
    remove: (tx: Parameters<typeof probeRepo.list>[0], id: string) =>
      tx.delete(unprotectedProbe).where(eq(unprotectedProbe.id, id)).returning(),
  };
  const twin = makeProbeRepo(unprotectedProbe);
  const snapshot = (tx: Parameters<typeof probeRepo.list>[0]) => tx.select().from(unprotectedProbe);

  beforeAll(async () => {
    await database.asMigrator((pool) => pool.query(UNPROTECTED_PROBE_SQL));
  });
  afterAll(async () => {
    await database.asMigrator((pool) => pool.query('DROP TABLE IF EXISTS _unprotected_probe'));
  });

  it.each(['get', 'update', 'remove'] as const)('catches a leaking %s', async (name) => {
    await expect(
      expectIsolated({
        database,
        seed: seedRow(twin),
        run: (tx, _ctxA, id) => leaky[name](tx, id),
        snapshot: (tx) => snapshot(tx),
      }),
    ).rejects.toThrow();
  });

  it.each([
    ['a SQL syntax error', (tx: Tx) => tx.execute(sql`select from from`)],
    ['a missing table', (tx: Tx) => tx.execute(sql`select * from no_such_table`)],
    ['a plain bug', () => Promise.reject(new Error('boom'))],
  ])('does not take %s for a refusal', async (_name, run) => {
    await expect(
      expectIsolated({
        database,
        seed: seedRow(probeRepo),
        run: (tx) => run(tx),
        snapshot: (tx, ctxB) => probeRepo.list(tx, ctxB),
        outcome: 'rejects',
        refusal: (error) => pgErrorCode(error) === PG.invalidText,
      }),
    ).rejects.toThrow(/unrelated error/);
  });

  it('knows an empty result when it sees one', () => {
    for (const empty of [undefined, null, [], 0, false, { rowCount: 0 }, { rows: [] }]) {
      expect(isEmptyResult(empty)).toBe(true);
    }
    for (const found of [{ id: 1 }, [1], 1, { rowCount: 2 }, { rows: [1] }, true]) {
      expect(isEmptyResult(found)).toBe(false);
    }
  });
});
