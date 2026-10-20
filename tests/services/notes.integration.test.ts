import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ConflictError,
  ForbiddenError,
  logger,
  MonthNoteDto,
  NoteDto,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '@nestvault/services';

import { createApiWorld, type ApiWorld, type Persona, type Scenario } from '../support/api-world';
import { rows } from '../support/auth-harness';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let world: ApiWorld;
let s: Scenario;

beforeAll(async () => {
  logger.level = 'silent';
  world = await createApiWorld();
});

beforeEach(async () => {
  s = await world.newScenario();
});

afterAll(async () => {
  await world.close();
});

const SECRET = 'Texto Secreto Da Nota 4711';

const ownerOf = (poolId: string): Persona => (poolId === s.poolB ? 'outsider' : 'owner');

async function movement(poolId = s.poolA) {
  const headers = await s.as(ownerOf(poolId));
  const [holder] = (await world.holders.list(headers, poolId)).holders;
  const account = await world.accounts.create(headers, poolId, {
    type: 'checking',
    name: 'Conta',
    currency: 'EUR',
    holderIds: [holder?.id ?? ''],
  });
  return world.transactions.create(headers, poolId, {
    accountId: account.id,
    date: '2026-03-10',
    description: 'COMPRA CONTINENTE',
    amount: '-12.5',
  });
}

async function operation(poolId = s.poolA) {
  const headers = await s.as(ownerOf(poolId));
  const portfolio = await world.portfolios.create(headers, poolId, {
    name: 'Reforma',
    color: '#112233',
    currency: 'EUR',
  });
  const asset = await world.assets.create(headers, poolId, {
    ticker: 'VWCE',
    name: 'Vanguard FTSE All-World',
    type: 'etf',
    currency: 'EUR',
  });
  return world.ops.create(headers, poolId, {
    portfolioId: portfolio.id,
    assetId: asset.id,
    type: 'buy',
    date: '2026-02-10',
    qty: '3',
    price: '10',
  });
}

const setTxNote = async (as: Persona, id: string, body: unknown, poolId = s.poolA) =>
  world.notes.setTransactionNote(await s.as(as), poolId, id, body);
const putMonth = async (as: Persona, month: string, body: unknown, poolId = s.poolA) =>
  world.notes.putMonthNote(await s.as(as), poolId, month, body);
const getMonth = async (as: Persona, month: string, poolId = s.poolA) =>
  world.notes.getMonthNote(await s.as(as), poolId, month);

describe('notes on movements', () => {
  it('lets owner, admin and member set and clear a note; viewer gets 403, a non-member 404', async () => {
    const tx = await movement();
    for (const persona of ['owner', 'admin', 'member'] as const) {
      const set = await setTxNote(persona, tx.id, { note: `Nota de ${persona}` });
      expect(NoteDto.parse(set)).toEqual(set);
      expect(set).toMatchObject({
        id: tx.id,
        note: `Nota de ${persona}`,
        noteUpdatedBy: s.ids[persona],
      });
      expect(set.noteUpdatedAt).toEqual(expect.any(String));
    }
    const listed = await world.transactions.list(await s.as('viewer'), s.poolA);
    expect(listed.transactions[0]?.note).toBe('Nota de member');

    await expect(setTxNote('viewer', tx.id, { note: 'x' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setTxNote('outsider', tx.id, { note: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.notes.setTransactionNote(new Headers(), s.poolA, tx.id, { note: 'x' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    // An empty text and null both clear.
    expect((await setTxNote('member', tx.id, { note: '   ' })).note).toBeNull();
    await setTxNote('member', tx.id, { note: 'outra' });
    expect((await setTxNote('member', tx.id, { note: null })).note).toBeNull();
    expect(
      (await world.transactions.list(await s.as('owner'), s.poolA)).transactions[0]?.note,
    ).toBeNull();
  });

  it('trims the text, keeps line breaks and refuses more than 2 000 characters (400)', async () => {
    const tx = await movement();
    expect((await setTxNote('owner', tx.id, { note: '  linha 1\nlinha 2  ' })).note).toBe(
      'linha 1\nlinha 2',
    );
    expect((await setTxNote('owner', tx.id, { note: 'x'.repeat(2000) })).note).toHaveLength(2000);
    for (const bad of [
      { note: 'x'.repeat(2001) },
      { note: 'a\u0000b' },
      { note: 5 },
      {},
      { note: 'ok', poolId: s.poolB },
      { note: 'ok', noteUpdatedBy: s.ids.viewer },
    ]) {
      await expect(setTxNote('owner', tx.id, bad)).rejects.toBeInstanceOf(ValidationError);
    }
    // Still the last good value.
    expect(
      (await world.transactions.list(await s.as('owner'), s.poolA)).transactions[0]?.note,
    ).toHaveLength(2000);
  });

  it('answers 404 for an unknown id and for a movement of another pool, changing nothing', async () => {
    const mine = await movement();
    const theirs = await movement(s.poolB);
    await expect(setTxNote('owner', 'not-an-id', { note: 'x' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(setTxNote('owner', theirs.id, { note: 'hijack' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const seen = await world.transactions.list(await s.as('outsider'), s.poolB);
    expect(seen.transactions.find((entry) => entry.id === theirs.id)?.note).toBeNull();
    expect(mine.id).not.toBe(theirs.id);
  });

  it('finds movements by the text of their note, literally', async () => {
    const one = await movement();
    await setTxNote('owner', one.id, { note: 'Desconto de 50% no seguro' });
    const two = await movement();
    await setTxNote('owner', two.id, { note: 'abc_def' });
    const query = async (noteQ: string) =>
      (await world.transactions.list(await s.as('viewer'), s.poolA, { noteQ })).transactions.map(
        (entry) => entry.id,
      );
    expect(await query('50%')).toEqual([one.id]);
    expect(await query('c_d')).toEqual([two.id]);
    expect(await query('%')).toEqual([one.id]);
    expect(await query("' OR 1=1 --")).toEqual([]);
  });

  it('keeps a note when the movement is changed by category or transfer edits', async () => {
    const tx = await movement();
    await setTxNote('owner', tx.id, { note: 'fica' });
    await world.transactions.update(await s.as('owner'), s.poolA, tx.id, { transfer: true });
    expect(
      (await world.transactions.list(await s.as('owner'), s.poolA)).transactions[0]?.note,
    ).toBe('fica');
  });
});

describe('notes on investment operations', () => {
  it('sets and clears a note; viewer gets 403', async () => {
    const op = await operation();
    const set = await world.notes.setOperationNote(await s.as('member'), s.poolA, op.id, {
      note: 'Reforço mensal',
    });
    expect(NoteDto.parse(set)).toMatchObject({ id: op.id, note: 'Reforço mensal' });
    expect((await world.ops.get(await s.as('viewer'), s.poolA, op.id)).note).toBe('Reforço mensal');
    await expect(
      world.notes.setOperationNote(await s.as('viewer'), s.poolA, op.id, { note: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      world.notes.setOperationNote(await s.as('outsider'), s.poolA, op.id, { note: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.notes.setOperationNote(await s.as('owner'), s.poolA, op.id, { note: 'x'.repeat(2001) }),
    ).rejects.toBeInstanceOf(ValidationError);
    const cleared = await world.notes.setOperationNote(await s.as('owner'), s.poolA, op.id, {
      note: null,
    });
    expect(cleared.note).toBeNull();
  });

  it('answers 404 for an operation of another pool and changes nothing', async () => {
    const theirs = await operation(s.poolB);
    await expect(
      world.notes.setOperationNote(await s.as('owner'), s.poolA, theirs.id, { note: 'hijack' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await world.ops.get(await s.as('outsider'), s.poolB, theirs.id)).note).toBeNull();
  });
});

describe('month notes', () => {
  it('reads an empty month, creates, edits with the version and clears', async () => {
    const empty = await getMonth('viewer', '2026-03');
    expect(MonthNoteDto.parse(empty)).toEqual({
      month: '2026-03',
      id: null,
      body: null,
      createdBy: null,
      updatedBy: null,
      updatedAt: null,
    });

    const created = await putMonth('member', '2026-03', {
      body: 'Mês de férias',
      expectedUpdatedAt: null,
    });
    expect(created).toMatchObject({
      month: '2026-03',
      body: 'Mês de férias',
      createdBy: s.ids.member,
      updatedBy: s.ids.member,
    });
    expect(await getMonth('viewer', '2026-03')).toEqual(created);

    const edited = await putMonth('admin', '2026-03', {
      body: 'Mês de férias e obras',
      expectedUpdatedAt: created.updatedAt,
    });
    expect(edited).toMatchObject({
      id: created.id,
      body: 'Mês de férias e obras',
      createdBy: s.ids.member,
      updatedBy: s.ids.admin,
    });
    expect(Date.parse(edited.updatedAt ?? '')).toBeGreaterThan(Date.parse(created.updatedAt ?? ''));

    const cleared = await putMonth('owner', '2026-03', {
      body: '  ',
      expectedUpdatedAt: edited.updatedAt,
    });
    expect(cleared.body).toBeNull();
    expect((await getMonth('owner', '2026-03')).body).toBeNull();
    // Clearing a month that has no note is a no-op.
    expect(
      (await putMonth('owner', '2026-03', { body: '', expectedUpdatedAt: null })).body,
    ).toBeNull();
  });

  it('answers 409 with the current version when the note changed meanwhile', async () => {
    const first = await putMonth('owner', '2026-03', { body: 'Versão 1', expectedUpdatedAt: null });
    // Two people loaded version 1; the admin saves first.
    const winner = await putMonth('admin', '2026-03', {
      body: 'Versão do admin',
      expectedUpdatedAt: first.updatedAt,
    });
    const lost = await putMonth('member', '2026-03', {
      body: 'Versão do membro',
      expectedUpdatedAt: first.updatedAt,
    }).catch((error: unknown) => error);
    expect(lost).toBeInstanceOf(ConflictError);
    expect((lost as ConflictError).current).toEqual(winner);
    expect((await getMonth('owner', '2026-03')).body).toBe('Versão do admin');

    // A creation that lost the race, and a version sent for a month that has no note.
    const raced = await putMonth('member', '2026-04', { body: 'Eu', expectedUpdatedAt: null });
    const late = await putMonth('owner', '2026-04', { body: 'Tu', expectedUpdatedAt: null }).catch(
      (error: unknown) => error,
    );
    expect(late).toBeInstanceOf(ConflictError);
    expect((late as ConflictError).current).toEqual(raced);
    const ghost = await putMonth('owner', '2026-05', {
      body: 'x',
      expectedUpdatedAt: first.updatedAt,
    }).catch((error: unknown) => error);
    expect(ghost).toBeInstanceOf(ConflictError);
    expect((ghost as ConflictError).current).toMatchObject({ month: '2026-05', body: null });
    // A stale clear is a conflict too, and does not delete the winner's text.
    const staleClear = await putMonth('owner', '2026-03', {
      body: '',
      expectedUpdatedAt: first.updatedAt,
    }).catch((error: unknown) => error);
    expect(staleClear).toBeInstanceOf(ConflictError);
    expect((await getMonth('owner', '2026-03')).body).toBe('Versão do admin');
  });

  it('really conflicts when two saves of the same version run at once', async () => {
    const first = await putMonth('owner', '2026-06', { body: 'Base', expectedUpdatedAt: null });
    const attempts = await Promise.allSettled(
      (['owner', 'admin', 'member'] as const).map((persona) =>
        putMonth(persona, '2026-06', { body: `de ${persona}`, expectedUpdatedAt: first.updatedAt }),
      ),
    );
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    for (const attempt of attempts) {
      if (attempt.status === 'rejected') expect(attempt.reason).toBeInstanceOf(ConflictError);
    }
  });

  it('validates yyyy-mm (2026-13 is 400), the length (10 001 is 400) and the body shape', async () => {
    for (const month of ['2026-13', '2026-00', '2026-1', '2026-03-01', 'março', "' OR 1=1 --"]) {
      await expect(getMonth('owner', month)).rejects.toBeInstanceOf(ValidationError);
      await expect(
        putMonth('owner', month, { body: 'x', expectedUpdatedAt: null }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    expect(
      (await putMonth('owner', '2026-07', { body: 'x'.repeat(10_000), expectedUpdatedAt: null }))
        .body,
    ).toHaveLength(10_000);
    for (const bad of [
      { body: 'x'.repeat(10_001), expectedUpdatedAt: null },
      { body: 'x' },
      { body: 'x', expectedUpdatedAt: 'ontem' },
      { body: 'x', expectedUpdatedAt: null, poolId: s.poolB },
      { body: 'x', expectedUpdatedAt: null, createdBy: s.ids.viewer },
      { body: 7, expectedUpdatedAt: null },
    ]) {
      await expect(putMonth('owner', '2026-08', bad)).rejects.toBeInstanceOf(ValidationError);
    }
    expect((await getMonth('owner', '2026-08')).body).toBeNull();
  });

  it('refuses viewer (403) and a non-member (404) on write, and a non-member on read', async () => {
    await expect(
      putMonth('viewer', '2026-03', { body: 'x', expectedUpdatedAt: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      putMonth('outsider', '2026-03', { body: 'x', expectedUpdatedAt: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(getMonth('outsider', '2026-03')).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.notes.getMonthNote(new Headers(), s.poolA, '2026-03'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(
      world.notes.putMonthNote(new Headers(), s.poolA, '2026-03', {
        body: 'x',
        expectedUpdatedAt: null,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('lists the notes of a range, oldest first, and validates the range', async () => {
    for (const month of ['2026-05', '2026-01', '2026-03', '2027-02']) {
      await putMonth('owner', month, { body: `Nota ${month}`, expectedUpdatedAt: null });
    }
    const headers = await s.as('viewer');
    const list = await world.notes.listMonthNotes(headers, s.poolA, {
      from: '2026-01',
      to: '2026-12',
    });
    expect(list.months.map((entry) => entry.month)).toEqual(['2026-01', '2026-03', '2026-05']);
    expect(
      (await world.notes.listMonthNotes(headers, s.poolA, { from: '2026-03', to: '2026-03' }))
        .months,
    ).toHaveLength(1);
    for (const bad of [
      { from: '2026-13', to: '2026-12' },
      { from: '2026-05', to: '2026-01' },
      { from: '2000-01', to: '2026-01' }, // wider than 120 months
      { from: '2026-01' },
      { from: '2026-01', to: '2026-02', extra: 1 },
    ]) {
      await expect(world.notes.listMonthNotes(headers, s.poolA, bad)).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    await expect(
      world.notes.listMonthNotes(await s.as('outsider'), s.poolA, {
        from: '2026-01',
        to: '2026-12',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('isolation and privacy of notes', () => {
  it('never shows the month notes of pool B in pool A, nor lets A change them', async () => {
    const theirs = await putMonth(
      'outsider',
      '2026-03',
      {
        body: SECRET,
        expectedUpdatedAt: null,
      },
      s.poolB,
    );
    expect((await getMonth('owner', '2026-03')).body).toBeNull();
    const range = { from: '2026-01', to: '2026-12' };
    expect(
      JSON.stringify(await world.notes.listMonthNotes(await s.as('owner'), s.poolA, range)),
    ).not.toContain(SECRET);
    // Writing the same month in A creates A's own note and leaves B's version alone.
    await putMonth('owner', '2026-03', { body: 'da A', expectedUpdatedAt: null });
    expect(await getMonth('outsider', '2026-03', s.poolB)).toEqual(theirs);
    // A's owner has no access to B's URL at all.
    await expect(getMonth('owner', '2026-03', s.poolB)).rejects.toBeInstanceOf(NotFoundError);
    // And sending B's version for A's month is a conflict, not a write into B.
    await expect(
      putMonth('owner', '2026-03', { body: 'x', expectedUpdatedAt: theirs.updatedAt }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('writes the audit entry with the row id only: the text never reaches the log', async () => {
    const tx = await movement();
    await setTxNote('owner', tx.id, { note: SECRET });
    const op = await operation();
    await world.notes.setOperationNote(await s.as('owner'), s.poolA, op.id, { note: SECRET });
    const month = await putMonth('owner', '2026-03', { body: SECRET, expectedUpdatedAt: null });
    await putMonth('owner', '2026-03', { body: `${SECRET} 2`, expectedUpdatedAt: month.updatedAt });

    const entries = await rows<{ action: string; target: string | null; meta: unknown }>(
      world.identity,
      sql`select action, target, meta from audit_log where action = 'note.updated' and pool_id = ${s.poolA} order by at`,
    );
    expect(entries.map((entry) => entry.target)).toEqual([tx.id, op.id, month.id, month.id]);
    expect(entries.every((entry) => entry.action === 'note.updated')).toBe(true);
    const everything = await rows(
      world.identity,
      sql`select * from audit_log where pool_id = ${s.poolA}`,
    );
    expect(JSON.stringify(everything)).not.toContain('Secreto');
  });

  it('does not audit a clear of a month that had no note', async () => {
    await putMonth('owner', '2026-09', { body: '', expectedUpdatedAt: null });
    const entries = await rows(
      world.identity,
      sql`select 1 from audit_log where action = 'note.updated' and pool_id = ${s.poolA}`,
    );
    expect(entries).toHaveLength(0);
  });
});
