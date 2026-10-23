import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  accountsRepo,
  importBatchesRepo,
  newId,
  type ImportBatchValues,
  type PoolContext,
  type PoolTx,
} from '@nestvault/db';

import { expectIsolated } from '../support/expect-isolated';

import { createTwoPools, failureCodeOf, openTestDatabase, pgErrorCode } from './harness';

const database = openTestDatabase(2);
const { withPool } = database;

beforeEach(async () => {
  await database.truncateAll();
});

afterAll(async () => {
  await database.close();
});

const CHECK_VIOLATION = '23514';
const USER = newId();
const NOW = new Date('2026-03-15T10:00:00.000Z');
const SHA = 'a'.repeat(64);

const account = (tx: PoolTx, ctx: PoolContext) =>
  accountsRepo.insert(tx, ctx, newId(), {
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

const values = (overrides: Partial<ImportBatchValues> = {}): ImportBatchValues => ({
  kind: 'bank',
  fileName: 'extrato.csv',
  fileSha256: SHA,
  sizeBytes: 2048,
  rowCount: 3,
  parserId: 'generic-csv',
  parserKind: 'bank',
  parserVersion: '1',
  confidence: '0.9500',
  reconciled: true,
  accountId: null,
  preview: { rows: [{ amount: '-1.20' }] },
  spec: null,
  ...overrides,
});

describe('importBatchesRepo', () => {
  it('stores a preview and reads it back', async () => {
    const { a } = createTwoPools();
    const id = newId();
    await withPool(a.ctx, (tx) => importBatchesRepo.insert(tx, a.ctx, id, values(), USER));
    const row = await withPool(a.ctx, (tx) => importBatchesRepo.find(tx, a.ctx, id));
    expect(row).toMatchObject({
      id,
      poolId: a.ctx.poolId,
      status: 'preview',
      fileSha256: SHA,
      confidence: '0.9500',
      createdBy: USER,
      preview: { rows: [{ amount: '-1.20' }] },
    });
  });

  it('commits once: a second commit finds no preview', async () => {
    const { a } = createTwoPools();
    const id = newId();
    const accountId = await withPool(a.ctx, async (tx) => {
      const created = await account(tx, a.ctx);
      await importBatchesRepo.insert(tx, a.ctx, id, values(), USER);
      return created.id;
    });
    const settle = { accountId, spec: { id: 'x' }, result: { inserted: 3 }, at: NOW };
    const first = await withPool(a.ctx, (tx) =>
      importBatchesRepo.markCommitted(tx, a.ctx, id, settle),
    );
    expect(first).toMatchObject({
      status: 'committed',
      accountId,
      preview: null,
      committedAt: NOW,
    });
    expect(first?.result).toEqual({ inserted: 3 });
    const second = await withPool(a.ctx, (tx) =>
      importBatchesRepo.markCommitted(tx, a.ctx, id, settle),
    );
    expect(second).toBeUndefined();
    const discarded = await withPool(a.ctx, (tx) =>
      importBatchesRepo.markDiscarded(tx, a.ctx, id, NOW),
    );
    expect(discarded).toBeUndefined();
  });

  it('discards a preview and drops its rows', async () => {
    const { a } = createTwoPools();
    const id = newId();
    await withPool(a.ctx, (tx) => importBatchesRepo.insert(tx, a.ctx, id, values(), USER));
    const row = await withPool(a.ctx, (tx) => importBatchesRepo.markDiscarded(tx, a.ctx, id, NOW));
    expect(row).toMatchObject({ status: 'discarded', preview: null });
  });

  it('finds the committed batch of a file, not a preview or a discarded one', async () => {
    const { a } = createTwoPools();
    const [preview, committed] = [newId(), newId()];
    const accountId = await withPool(a.ctx, async (tx) => {
      const created = await account(tx, a.ctx);
      await importBatchesRepo.insert(tx, a.ctx, preview, values(), USER);
      await importBatchesRepo.insert(tx, a.ctx, committed, values(), USER);
      return created.id;
    });
    const none = await withPool(a.ctx, (tx) =>
      importBatchesRepo.findCommittedByHash(tx, a.ctx, SHA),
    );
    expect(none).toBeUndefined();
    await withPool(a.ctx, (tx) =>
      importBatchesRepo.markCommitted(tx, a.ctx, committed, {
        accountId,
        spec: null,
        result: {},
        at: NOW,
      }),
    );
    const found = await withPool(a.ctx, (tx) =>
      importBatchesRepo.findCommittedByHash(tx, a.ctx, SHA),
    );
    expect(found).toMatchObject({ id: committed, accountId, committedAt: NOW });
  });

  it('remembers the parser and mapping of the last commit of an account', async () => {
    const { a } = createTwoPools();
    const accountId = await withPool(a.ctx, async (tx) => (await account(tx, a.ctx)).id);
    const settle = async (id: string, parserId: string, spec: unknown, at: Date) => {
      await withPool(a.ctx, async (tx) => {
        await importBatchesRepo.insert(
          tx,
          a.ctx,
          id,
          values({
            parserId,
            fileSha256: id
              .padEnd(64, '0')
              .slice(0, 64)
              .replace(/[^0-9a-f]/g, '0'),
          }),
          USER,
        );
        await importBatchesRepo.markCommitted(tx, a.ctx, id, { accountId, spec, result: {}, at });
      });
    };
    await settle(newId(), 'older', { v: 1 }, new Date('2026-01-01T00:00:00Z'));
    await settle(newId(), 'newer', { v: 2 }, new Date('2026-02-01T00:00:00Z'));
    const remembered = await withPool(a.ctx, (tx) =>
      importBatchesRepo.lastForAccount(tx, a.ctx, accountId),
    );
    expect(remembered).toMatchObject({ parserId: 'newer', spec: { v: 2 } });
    const other = await withPool(a.ctx, (tx) =>
      importBatchesRepo.lastForAccount(tx, a.ctx, newId()),
    );
    expect(other).toBeUndefined();
  });

  it.each([
    ['unknown kind', { kind: 'weird' as never }],
    ['unknown parser kind', { parserKind: 'weird' as never }],
    ['short hash', { fileSha256: 'abc' }],
    ['upper-case hash', { fileSha256: 'A'.repeat(64) }],
    ['empty file name', { fileName: '' }],
    ['file name over 255', { fileName: 'x'.repeat(256) }],
    ['empty file', { sizeBytes: 0 }],
    ['file over 10 MB', { sizeBytes: 10 * 1024 * 1024 + 1 }],
    ['negative rows', { rowCount: -1 }],
    ['confidence over 1', { confidence: '1.0001' }],
  ])('refuses %s', async (_name, overrides) => {
    const { a } = createTwoPools();
    const error = await failureCodeOf(
      withPool(a.ctx, (tx) =>
        importBatchesRepo.insert(tx, a.ctx, newId(), values(overrides), USER),
      ),
    );
    expect(error).toBe(CHECK_VIOLATION);
  });

  it('stores hostile text literally and keeps the table', async () => {
    const { a } = createTwoPools();
    const payloads = ["' OR 1=1 --", "'; DROP TABLE import_batches; --"];
    for (const payload of payloads) {
      const id = newId();
      await withPool(a.ctx, (tx) =>
        importBatchesRepo.insert(
          tx,
          a.ctx,
          id,
          values({
            fileName: payload,
            parserId: payload,
            parserVersion: payload,
            preview: { note: payload },
            spec: { id: payload },
          }),
          USER,
        ),
      );
      const row = await withPool(a.ctx, (tx) => importBatchesRepo.find(tx, a.ctx, id));
      expect(row?.fileName).toBe(payload);
      expect(row?.preview).toEqual({ note: payload });
    }
    const count = await withPool(a.ctx, async (tx) => {
      const result = await tx.execute(sql`select count(*)::int as n from import_batches`);
      return (result.rows[0] as { n: number }).n;
    });
    expect(count).toBe(2);
  });

  it('lists committed batches newest first, only committed ones, and as data for the account', async () => {
    const { a } = createTwoPools();
    const ids = [newId(), newId(), newId()];
    const accountId = await withPool(a.ctx, async (tx) => {
      const created = await account(tx, a.ctx);
      for (const id of ids) await importBatchesRepo.insert(tx, a.ctx, id, values(), USER);
      return created.id;
    });
    const settle = (at: string) => ({
      accountId,
      spec: null,
      result: { inserted: 2 },
      at: new Date(at),
    });
    await withPool(a.ctx, async (tx) => {
      await importBatchesRepo.markCommitted(
        tx,
        a.ctx,
        ids[0] ?? '',
        settle('2026-03-01T10:00:00Z'),
      );
      await importBatchesRepo.markCommitted(
        tx,
        a.ctx,
        ids[1] ?? '',
        settle('2026-03-02T10:00:00Z'),
      );
    });
    const listed = await withPool(a.ctx, (tx) =>
      importBatchesRepo.listCommitted(tx, a.ctx, { limit: 50 }),
    );
    expect(listed.map((row) => row.id)).toEqual([ids[1], ids[0]]);
    const limited = await withPool(a.ctx, (tx) =>
      importBatchesRepo.listCommitted(tx, a.ctx, { accountId, limit: 1 }),
    );
    expect(limited.map((row) => row.id)).toEqual([ids[1]]);
    // A payload where an id goes is bound as a parameter: Postgres rejects it as a uuid, it never runs.
    await expect(
      withPool(a.ctx, (tx) =>
        importBatchesRepo.listCommitted(tx, a.ctx, { accountId: "' OR 1=1 --", limit: 50 }),
      ),
    ).rejects.toThrow();
    expect(
      await withPool(a.ctx, (tx) => importBatchesRepo.listCommitted(tx, a.ctx, { limit: 50 })),
    ).toHaveLength(2);
  });

  it('looks a hash up as data: an injection payload finds nothing', async () => {
    const { a } = createTwoPools();
    await withPool(a.ctx, (tx) => importBatchesRepo.insert(tx, a.ctx, newId(), values(), USER));
    const found = await withPool(a.ctx, (tx) =>
      importBatchesRepo.findCommittedByHash(tx, a.ctx, "' OR 1=1 --"),
    );
    expect(found).toBeUndefined();
  });

  it('a deleted account leaves the batch as history without the account', async () => {
    const { a } = createTwoPools();
    const id = newId();
    const accountId = await withPool(a.ctx, async (tx) => {
      const created = await account(tx, a.ctx);
      await importBatchesRepo.insert(tx, a.ctx, id, values(), USER);
      await importBatchesRepo.markCommitted(tx, a.ctx, id, {
        accountId: created.id,
        spec: null,
        result: {},
        at: NOW,
      });
      return created.id;
    });
    await withPool(a.ctx, (tx) => accountsRepo.remove(tx, a.ctx, accountId));
    const row = await withPool(a.ctx, (tx) => importBatchesRepo.find(tx, a.ctx, id));
    expect(row).toMatchObject({ status: 'committed', accountId: null });
  });
});

describe('RLS on import_batches', () => {
  it('a raw select without the pool filter sees only the pool in context', async () => {
    const { a, b } = createTwoPools();
    await withPool(a.ctx, (tx) => importBatchesRepo.insert(tx, a.ctx, newId(), values(), USER));
    await withPool(b.ctx, (tx) =>
      importBatchesRepo.insert(tx, b.ctx, newId(), values({ fileName: 'b.csv' }), USER),
    );
    const names = await withPool(a.ctx, async (tx) => {
      const result = await tx.execute(sql`select file_name from import_batches`);
      return result.rows.map((row) => (row as { file_name: string }).file_name);
    });
    expect(names).toEqual(['extrato.csv']);
  });

  it('refuses to write a row for another pool', async () => {
    const { a, b } = createTwoPools();
    const error = await failureCodeOf(
      withPool(a.ctx, (tx) =>
        tx.execute(sql`
          insert into import_batches (id, pool_id, kind, file_name, file_sha256, size_bytes, row_count,
            parser_id, parser_kind, parser_version, confidence, created_by)
          values (${newId()}, ${b.ctx.poolId}, 'bank', 'x.csv', ${SHA}, 1, 0, 'p', 'bank', '1', 0.5, ${USER})`),
      ),
    );
    expect(error).toBe('42501');
  });
});

describe('isolation between pools', () => {
  const seed = async (tx: PoolTx, ctxB: PoolContext) => {
    const created = await account(tx, ctxB);
    const id = newId();
    await importBatchesRepo.insert(tx, ctxB, id, values(), USER);
    return { id, accountId: created.id };
  };
  type Seed = Awaited<ReturnType<typeof seed>>;
  const snapshot = (tx: PoolTx, ctxB: PoolContext, s: Seed) =>
    importBatchesRepo.find(tx, ctxB, s.id);
  const check = (run: (tx: PoolTx, ctxA: PoolContext, seeded: Seed) => Promise<unknown>) =>
    expectIsolated({ database, seed, snapshot, run });

  it('find finds nothing of pool B', () =>
    check((tx, ctxA, s) => importBatchesRepo.find(tx, ctxA, s.id)));
  it('findCommittedByHash finds nothing of pool B', async () => {
    await expectIsolated({
      database,
      seed: async (tx, ctxB) => {
        const { id, accountId } = await seed(tx, ctxB);
        await importBatchesRepo.markCommitted(tx, ctxB, id, {
          accountId,
          spec: null,
          result: {},
          at: NOW,
        });
        return id;
      },
      snapshot: (tx, ctxB, id) => importBatchesRepo.find(tx, ctxB, id),
      run: (tx, ctxA) => importBatchesRepo.findCommittedByHash(tx, ctxA, SHA),
    });
  });
  it('listCommitted lists nothing of pool B', async () => {
    await expectIsolated({
      database,
      seed: async (tx, ctxB) => {
        const { id, accountId } = await seed(tx, ctxB);
        await importBatchesRepo.markCommitted(tx, ctxB, id, {
          accountId,
          spec: null,
          result: {},
          at: NOW,
        });
        return id;
      },
      snapshot: (tx, ctxB, id) => importBatchesRepo.find(tx, ctxB, id),
      run: (tx, ctxA) => importBatchesRepo.listCommitted(tx, ctxA, { limit: 50 }),
    });
  });
  it('lastForAccount finds nothing of pool B', () =>
    check((tx, ctxA, s) => importBatchesRepo.lastForAccount(tx, ctxA, s.accountId)));
  it('markCommitted changes nothing of pool B', () =>
    check((tx, ctxA, s) =>
      importBatchesRepo.markCommitted(tx, ctxA, s.id, {
        accountId: s.accountId,
        spec: null,
        result: {},
        at: NOW,
      }),
    ));
  it('markDiscarded changes nothing of pool B', () =>
    check((tx, ctxA, s) => importBatchesRepo.markDiscarded(tx, ctxA, s.id, NOW)));
  it('insert cannot point at an account of pool B', async () => {
    await expectIsolated({
      database,
      seed: async (tx, ctxB) => (await account(tx, ctxB)).id,
      snapshot: (tx, ctxB) => importBatchesRepo.find(tx, ctxB, newId()),
      outcome: 'rejects',
      refusal: (error) => pgErrorCode(error) === '23503',
      run: (tx, ctxA, accountId) =>
        importBatchesRepo.insert(tx, ctxA, newId(), values({ accountId }), USER),
    });
  });
});
