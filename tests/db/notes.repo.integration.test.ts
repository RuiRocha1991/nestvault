import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  accountsRepo,
  assetsRepo,
  investmentOpsRepo,
  monthNotesRepo,
  newId,
  notesRepo,
  portfoliosRepo,
  transactionsRepo,
  type PoolContext,
  type PoolTx,
  type TransactionValues,
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
const UNIQUE_VIOLATION = '23505';

const NOW = new Date('2026-03-15T10:00:00.000Z');
const USER = newId();

const account = (tx: PoolTx, ctx: PoolContext, type = 'checking') =>
  accountsRepo.insert(tx, ctx, newId(), {
    type,
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

const txValues = (accountId: string, hash = `h-${newId()}`): TransactionValues => ({
  accountId,
  date: '2026-03-10',
  description: 'COMPRA CONTINENTE',
  amount: '-12.5',
  categoryId: null,
  transfer: false,
  transferLocked: false,
  manualCategory: false,
  hash,
});

const movement = async (tx: PoolTx, ctx: PoolContext) =>
  transactionsRepo.insert(tx, ctx, newId(), txValues((await account(tx, ctx)).id));

const operation = async (tx: PoolTx, ctx: PoolContext) => {
  const portfolio = await portfoliosRepo.insert(tx, ctx, newId(), {
    name: 'Reforma',
    color: '#112233',
    currency: 'EUR',
    note: null,
    targets: {},
  });
  const asset = await assetsRepo.insert(tx, ctx, newId(), {
    ticker: 'VWCE',
    symbol: null,
    name: 'VWCE',
    type: 'etf',
    currency: 'EUR',
    sector: null,
    region: null,
    dps: null,
    divMonths: [],
  });
  return investmentOpsRepo.insert(tx, ctx, newId(), {
    portfolioId: portfolio.id,
    assetId: asset.id,
    accountId: null,
    subAccountId: null,
    type: 'buy',
    date: '2026-03-10',
    qty: '2',
    price: '10',
    fee: null,
    amount: null,
    gross: null,
    tax: null,
    fromCash: false,
    planId: null,
    planPeriod: null,
    extId: null,
    note: null,
  });
};

const monthNote = (month = '2026-03-01', body = 'Mês de férias') => ({
  id: newId(),
  month,
  body,
  userId: USER,
  at: NOW,
});

describe('notes on movements and operations', () => {
  it('sets, replaces and clears a movement note, recording who and when', async () => {
    const { a } = createTwoPools();
    const row = await withPool(a.ctx, (tx) => movement(tx, a.ctx));
    const set = await withPool(a.ctx, (tx) =>
      notesRepo.setTransactionNote(tx, a.ctx, row.id, 'Jantar de anos', USER, NOW),
    );
    expect(set).toEqual({
      id: row.id,
      note: 'Jantar de anos',
      noteUpdatedBy: USER,
      noteUpdatedAt: NOW,
    });
    const cleared = await withPool(a.ctx, (tx) =>
      notesRepo.setTransactionNote(tx, a.ctx, row.id, null, USER, NOW),
    );
    expect(cleared).toMatchObject({ note: null, noteUpdatedBy: USER });
    const stored = await withPool(a.ctx, (tx) => transactionsRepo.find(tx, a.ctx, row.id));
    expect(stored?.note).toBeNull();
  });

  it('sets the note of an investment operation', async () => {
    const { a } = createTwoPools();
    const op = await withPool(a.ctx, (tx) => operation(tx, a.ctx));
    const set = await withPool(a.ctx, (tx) =>
      notesRepo.setOperationNote(tx, a.ctx, op.id, 'Reforço', USER, NOW),
    );
    expect(set).toMatchObject({ id: op.id, note: 'Reforço', noteUpdatedAt: NOW });
  });

  it('refuses a note of 2 001 characters and takes 2 000', async () => {
    const { a } = createTwoPools();
    const row = await withPool(a.ctx, (tx) => movement(tx, a.ctx));
    const op = await withPool(a.ctx, (tx) => operation(tx, a.ctx));
    await expect(
      failureCodeOf(
        withPool(a.ctx, (tx) =>
          notesRepo.setTransactionNote(tx, a.ctx, row.id, 'x'.repeat(2001), USER, NOW),
        ),
      ),
    ).resolves.toBe(CHECK_VIOLATION);
    await expect(
      failureCodeOf(
        withPool(a.ctx, (tx) =>
          notesRepo.setOperationNote(tx, a.ctx, op.id, 'x'.repeat(2001), USER, NOW),
        ),
      ),
    ).resolves.toBe(CHECK_VIOLATION);
    const ok = await withPool(a.ctx, (tx) =>
      notesRepo.setTransactionNote(tx, a.ctx, row.id, 'x'.repeat(2000), USER, NOW),
    );
    expect(ok?.note).toHaveLength(2000);
  });

  it('keeps notes when an import meets the same movement again (ON CONFLICT DO NOTHING)', async () => {
    const { a } = createTwoPools();
    const acc = await withPool(a.ctx, (tx) => account(tx, a.ctx));
    const values = txValues(acc.id, 'same-hash');
    const id = newId();
    expect(
      await withPool(a.ctx, (tx) =>
        transactionsRepo.insertIgnoringDuplicate(tx, a.ctx, id, values),
      ),
    ).toBe(true);
    await withPool(a.ctx, (tx) =>
      notesRepo.setTransactionNote(tx, a.ctx, id, 'A minha nota', USER, NOW),
    );
    // The second import sees the same hash, with other text: nothing is written.
    expect(
      await withPool(a.ctx, (tx) =>
        transactionsRepo.insertIgnoringDuplicate(tx, a.ctx, newId(), {
          ...values,
          description: 'COMPRA CONTINENTE (reimportada)',
        }),
      ),
    ).toBe(false);
    const stored = await withPool(a.ctx, (tx) => transactionsRepo.find(tx, a.ctx, id));
    expect(stored).toMatchObject({
      note: 'A minha nota',
      noteUpdatedBy: USER,
      description: 'COMPRA CONTINENTE',
    });
  });

  it('searches the notes literally: %, _ and quotes are data', async () => {
    const { a } = createTwoPools();
    const acc = await withPool(a.ctx, (tx) => account(tx, a.ctx));
    const notes = ['50% do seguro', 'abc_def', "' OR 1=1 --"];
    for (const note of notes) {
      const row = await withPool(a.ctx, (tx) =>
        transactionsRepo.insert(tx, a.ctx, newId(), txValues(acc.id)),
      );
      await withPool(a.ctx, (tx) =>
        notesRepo.setTransactionNote(tx, a.ctx, row.id, note, USER, NOW),
      );
    }
    await withPool(a.ctx, (tx) => transactionsRepo.insert(tx, a.ctx, newId(), txValues(acc.id)));
    const find = async (noteText: string) =>
      (
        await withPool(a.ctx, (tx) =>
          transactionsRepo.list(
            tx,
            a.ctx,
            { noteText },
            { by: 'date', descending: true },
            null,
            100,
          ),
        )
      ).rows.map((row) => row.note);
    expect(await find('50%')).toEqual(['50% do seguro']);
    expect(await find('c_d')).toEqual(['abc_def']);
    expect(await find('%')).toEqual(['50% do seguro']);
    expect(await find("' OR 1=1 --")).toEqual(["' OR 1=1 --"]);
    expect(await find('SEGURO')).toEqual(['50% do seguro']);
  });

  it('treats injection payloads in a note as data', async () => {
    const { a } = createTwoPools();
    const row = await withPool(a.ctx, (tx) => movement(tx, a.ctx));
    for (const payload of ["' OR 1=1 --", "'; DROP TABLE transactions; --"]) {
      const set = await withPool(a.ctx, (tx) =>
        notesRepo.setTransactionNote(tx, a.ctx, row.id, payload, USER, NOW),
      );
      expect(set?.note).toBe(payload);
    }
    expect(await withPool(a.ctx, (tx) => transactionsRepo.find(tx, a.ctx, row.id))).toBeDefined();
    await expect(
      failureCodeOf(
        withPool(a.ctx, (tx) =>
          notesRepo.setTransactionNote(tx, a.ctx, "' OR 1=1 --", 'x', USER, NOW),
        ),
      ),
    ).resolves.toBe('22P02');
  });
});

describe('notes of a date range', () => {
  it('lists only the noted movements of the range and of the pool', async () => {
    const { a, b } = createTwoPools();
    const inRange = await withPool(a.ctx, (tx) => movement(tx, a.ctx));
    const plain = await withPool(a.ctx, (tx) => movement(tx, a.ctx));
    const other = await withPool(b.ctx, (tx) => movement(tx, b.ctx));
    await withPool(a.ctx, (tx) =>
      notesRepo.setTransactionNote(tx, a.ctx, inRange.id, 'Nota A', USER, NOW),
    );
    await withPool(b.ctx, (tx) =>
      notesRepo.setTransactionNote(tx, b.ctx, other.id, 'Nota B', USER, NOW),
    );
    const list = (from: string, to: string) =>
      withPool(a.ctx, (tx) => notesRepo.listTransactionNotes(tx, a.ctx, from, to));
    const found = await list('2026-03-01', '2026-03-31');
    expect(found.map((row) => row.id)).toEqual([inRange.id]);
    expect(found.map((row) => row.id)).not.toContain(plain.id);
    expect(await list('2026-04-01', '2026-04-30')).toEqual([]);
  });

  it('treats injection payloads in the range as data', async () => {
    const { a } = createTwoPools();
    await expect(
      failureCodeOf(
        withPool(a.ctx, (tx) =>
          notesRepo.listTransactionNotes(tx, a.ctx, "' OR 1=1 --", '2026-03-31'),
        ),
      ),
    ).resolves.toBe('22007');
  });
});

describe('month notes repository', () => {
  it('inserts, finds, lists in order, updates and removes by version', async () => {
    const { a } = createTwoPools();
    const march = await withPool(a.ctx, (tx) => monthNotesRepo.insert(tx, a.ctx, monthNote()));
    await withPool(a.ctx, (tx) =>
      monthNotesRepo.insert(tx, a.ctx, monthNote('2026-01-01', 'Janeiro')),
    );
    await withPool(a.ctx, (tx) =>
      monthNotesRepo.insert(tx, a.ctx, monthNote('2027-01-01', 'Fora do intervalo')),
    );
    expect(march).toMatchObject({ month: '2026-03-01', body: 'Mês de férias', createdBy: USER });
    expect((await withPool(a.ctx, (tx) => monthNotesRepo.find(tx, a.ctx, '2026-03-01')))?.id).toBe(
      march?.id,
    );
    const listed = await withPool(a.ctx, (tx) =>
      monthNotesRepo.list(tx, a.ctx, '2026-01-01', '2026-12-01'),
    );
    expect(listed.map((row) => row.month)).toEqual(['2026-01-01', '2026-03-01']);

    const id = march?.id ?? '';
    const stale = new Date(NOW.getTime() - 1);
    expect(
      await withPool(a.ctx, (tx) =>
        monthNotesRepo.updateIfVersion(tx, a.ctx, id, stale, { body: 'x', userId: USER, at: NOW }),
      ),
    ).toBeUndefined();
    // The same millisecond cannot reuse a version: the new one is strictly later.
    const updated = await withPool(a.ctx, (tx) =>
      monthNotesRepo.updateIfVersion(tx, a.ctx, id, NOW, { body: 'Novo', userId: USER, at: NOW }),
    );
    expect(updated?.body).toBe('Novo');
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(NOW.getTime());
    expect(await withPool(a.ctx, (tx) => monthNotesRepo.removeIfVersion(tx, a.ctx, id, NOW))).toBe(
      false,
    );
    expect(
      await withPool(a.ctx, (tx) =>
        monthNotesRepo.removeIfVersion(tx, a.ctx, id, updated?.updatedAt ?? NOW),
      ),
    ).toBe(true);
  });

  it('answers undefined, not an error, when the month already has a note', async () => {
    const { a } = createTwoPools();
    await withPool(a.ctx, (tx) => monthNotesRepo.insert(tx, a.ctx, monthNote()));
    expect(
      await withPool(a.ctx, (tx) =>
        monthNotesRepo.insert(tx, a.ctx, monthNote('2026-03-01', 'Outra')),
      ),
    ).toBeUndefined();
  });

  it('enforces the first day of the month, the length and one note per month', async () => {
    const { a } = createTwoPools();
    const insert = (month: string, body: string) =>
      withPool(a.ctx, (tx) => monthNotesRepo.insert(tx, a.ctx, monthNote(month, body)));
    await expect(failureCodeOf(insert('2026-03-15', 'x'))).resolves.toBe(CHECK_VIOLATION);
    await expect(failureCodeOf(insert('2026-03-01', ''))).resolves.toBe(CHECK_VIOLATION);
    await expect(failureCodeOf(insert('2026-03-01', 'x'.repeat(10_001)))).resolves.toBe(
      CHECK_VIOLATION,
    );
    expect((await insert('2026-03-01', 'x'.repeat(10_000)))?.body).toHaveLength(10_000);
    // The unique key is the safety net behind the ON CONFLICT of the repository.
    await expect(
      failureCodeOf(
        withPool(a.ctx, (tx) =>
          tx.execute(
            sql`insert into month_notes (id, pool_id, month, body, created_by, updated_by)
                values (${newId()}, ${a.poolId}, '2026-03-01', 'dup', ${USER}, ${USER})`,
          ),
        ),
      ),
    ).resolves.toBe(UNIQUE_VIOLATION);
  });

  it('keeps the same month of two pools apart', async () => {
    const { a, b } = createTwoPools();
    await withPool(a.ctx, (tx) => monthNotesRepo.insert(tx, a.ctx, monthNote()));
    expect(
      await withPool(b.ctx, (tx) => monthNotesRepo.insert(tx, b.ctx, monthNote('2026-03-01', 'B'))),
    ).toBeDefined();
    expect(
      (await withPool(b.ctx, (tx) => monthNotesRepo.find(tx, b.ctx, '2026-03-01')))?.body,
    ).toBe('B');
  });

  it('treats injection payloads as data', async () => {
    const { a } = createTwoPools();
    const payload = "'; DROP TABLE month_notes; -- ' OR 1=1";
    await withPool(a.ctx, (tx) =>
      monthNotesRepo.insert(tx, a.ctx, monthNote('2026-03-01', payload)),
    );
    expect(
      (await withPool(a.ctx, (tx) => monthNotesRepo.find(tx, a.ctx, '2026-03-01')))?.body,
    ).toBe(payload);
    await expect(
      failureCodeOf(withPool(a.ctx, (tx) => monthNotesRepo.find(tx, a.ctx, "' OR 1=1 --"))),
    ).resolves.toBe('22007');
  });
});

describe('isolation between pools (repository filter and RLS)', () => {
  const seed = async (tx: PoolTx, ctxB: PoolContext) => {
    const row = await movement(tx, ctxB);
    const op = await operation(tx, ctxB);
    await notesRepo.setTransactionNote(tx, ctxB, row.id, 'pool B secret', USER, NOW);
    await notesRepo.setOperationNote(tx, ctxB, op.id, 'pool B secret', USER, NOW);
    const month = await monthNotesRepo.insert(tx, ctxB, monthNote('2026-03-01', 'pool B secret'));
    return { transactionId: row.id, opId: op.id, monthId: month?.id ?? '' };
  };
  const snapshot = async (
    tx: PoolTx,
    ctxB: PoolContext,
    seeded: Awaited<ReturnType<typeof seed>>,
  ) => ({
    transaction: await transactionsRepo.find(tx, ctxB, seeded.transactionId),
    op: await investmentOpsRepo.find(tx, ctxB, seeded.opId),
    months: await monthNotesRepo.list(tx, ctxB, '2000-01-01', '2100-01-01'),
  });
  type Seed = Awaited<ReturnType<typeof seed>>;
  const check = (run: (tx: PoolTx, ctxA: PoolContext, seeded: Seed) => Promise<unknown>) =>
    expectIsolated({ database, seed, snapshot, run });

  it('setTransactionNote changes nothing of pool B', () =>
    check((tx, ctxA, s) =>
      notesRepo.setTransactionNote(tx, ctxA, s.transactionId, 'hijack', USER, NOW),
    ));
  it('setOperationNote changes nothing of pool B', () =>
    check((tx, ctxA, s) => notesRepo.setOperationNote(tx, ctxA, s.opId, 'hijack', USER, NOW)));
  it('monthNotes: find finds nothing of pool B', () =>
    check((tx, ctxA) => monthNotesRepo.find(tx, ctxA, '2026-03-01')));
  it('monthNotes: list finds nothing of pool B', () =>
    check((tx, ctxA) => monthNotesRepo.list(tx, ctxA, '2000-01-01', '2100-01-01')));
  it('monthNotes: updateIfVersion changes nothing of pool B', () =>
    check((tx, ctxA, s) =>
      monthNotesRepo.updateIfVersion(tx, ctxA, s.monthId, NOW, {
        body: 'hijack',
        userId: USER,
        at: NOW,
      }),
    ));
  it('monthNotes: removeIfVersion deletes nothing of pool B', () =>
    check((tx, ctxA, s) => monthNotesRepo.removeIfVersion(tx, ctxA, s.monthId, NOW)));
  it('transactions: insertIgnoringDuplicate writes nothing into an account of pool B', async () => {
    await expectIsolated({
      database,
      seed: async (tx, ctxB) => (await account(tx, ctxB)).id,
      snapshot: (tx, ctxB) => transactionsRepo.listForEngine(tx, ctxB),
      outcome: 'rejects',
      refusal: (error) => pgErrorCode(error) === '23503',
      run: (tx, ctxA, accountId) =>
        transactionsRepo.insertIgnoringDuplicate(tx, ctxA, newId(), txValues(accountId)),
    });
  });
});
