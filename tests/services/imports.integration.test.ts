import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ConflictError,
  ForbiddenError,
  logger,
  NotFoundError,
  PayloadTooLargeError,
  RateLimitError,
  UnauthorizedError,
  UnprocessableError,
  UnsupportedMediaTypeError,
  ValidationError,
  ImportStartDto,
  type ImportPreviewDto,
} from '@nestvault/services';

import { createApiWorld, type ApiWorld, type Persona, type Scenario } from '../support/api-world';
import { rows } from '../support/auth-harness';
import {
  bankRow,
  brokerRow,
  candidate,
  responseOf,
  type FakeParser,
  type FakeRow,
} from '../support/imports';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let world: ApiWorld;
let s: Scenario;
let parser: FakeParser;

beforeAll(async () => {
  logger.level = 'silent';
  world = await createApiWorld();
  parser = world.importsKit.parser;
});

beforeEach(async () => {
  s = await world.newScenario();
  parser.reset();
});

afterAll(async () => {
  await world.close();
});

// ---------------------------------------------------------------------------------- helpers

const CSV = Buffer.from('Data;Descrição;Valor\n05-01-2026;Coffee;-1,20\n', 'utf8');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function holderId(as: Persona = 'owner', poolId = s.poolA) {
  const [holder] = (await world.holders.list(await s.as(as), poolId)).holders;
  return holder?.id ?? '';
}

async function makeAccount(name: string, extra: Record<string, unknown> = {}, poolId = s.poolA) {
  const as: Persona = poolId === s.poolA ? 'owner' : 'outsider';
  return world.accounts.create(await s.as(as), poolId, {
    type: 'checking',
    name,
    currency: 'EUR',
    holderIds: [await holderId(as, poolId)],
    ...extra,
  });
}

interface StartOptions {
  as?: Persona;
  poolId?: string;
  bytes?: Uint8Array;
  fileName?: string;
  fields?: Record<string, unknown>;
}

async function start({
  as = 'owner',
  poolId = s.poolA,
  bytes = CSV,
  fileName = 'extrato.csv',
  fields = {},
}: StartOptions = {}) {
  return world.imports.start(await s.as(as), poolId, () =>
    Promise.resolve({ fileName, bytes, fields }),
  );
}

async function preview(options: StartOptions = {}): Promise<ImportPreviewDto> {
  const result = await start(options);
  if (result.status !== 'preview') throw new Error(`expected a preview, got ${result.status}`);
  return result;
}

const commit = async (batchId: string, body: unknown, as: Persona = 'owner', poolId = s.poolA) =>
  world.imports.commit(await s.as(as), poolId, batchId, body);

const transactionCount = async () =>
  Number(
    (
      await world.database.withPool(
        { ...(await poolContext()) },
        async (tx) => (await tx.execute(sql`select count(*)::int as n from transactions`)).rows,
      )
    )[0]?.['n'],
  );

async function poolContext() {
  // A context for pool A built by the same guard the services use.
  const { requirePoolAccess } = await import('@nestvault/services');
  const { requireSession } = await import('@nestvault/services');
  const headers = await s.as('owner');
  const session = await requireSession(world.auth, headers);
  return requirePoolAccess(world.identity, session, s.poolA);
}

async function ledger(accountId: string) {
  const page = await world.transactions.list(await s.as('owner'), s.poolA, {
    accountId,
    limit: 200,
  });
  return page.transactions;
}

const bankFile = (...lines: FakeRow[]) => {
  parser.response = responseOf(lines);
};

async function auditActions() {
  return rows<{ action: string; target: string | null; meta: Record<string, unknown> }>(
    world.identity,
    sql`select action, target, meta from audit_log where pool_id = ${s.poolA} and action like 'import.%' order by at, id`,
  );
}

// ------------------------------------------------------------------------------------ guards

describe('imports service: who may upload', () => {
  it('lets owner, admin and member upload; refuses viewer (403), a non-member (404) and no session (401)', async () => {
    for (const as of ['owner', 'admin', 'member'] as const) {
      expect((await start({ as })).status).toBe('preview');
    }
    await expect(start({ as: 'viewer' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(start({ as: 'outsider' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.imports.start(new Headers(), s.poolA, () =>
        Promise.resolve({ fileName: 'a.csv', bytes: CSV, fields: {} }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('does not read the upload of a caller who is not allowed', async () => {
    const read = vi.fn(() => Promise.resolve({ fileName: 'a.csv', bytes: CSV, fields: {} }));
    await expect(world.imports.start(await s.as('viewer'), s.poolA, read)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(world.imports.start(await s.as('outsider'), s.poolA, read)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(read).not.toHaveBeenCalled();
    expect(parser.calls).toEqual([]);
  });

  it('allows 20 uploads an hour per pool and then answers 429', async () => {
    for (let n = 0; n < 20; n += 1) await start();
    await expect(start()).rejects.toBeInstanceOf(RateLimitError);
    // Another pool has its own allowance.
    expect((await start({ as: 'outsider', poolId: s.poolB })).status).toBe('preview');
  });
});

describe('imports service: the file', () => {
  it('rejects an executable renamed .xlsx before any parser sees it (415)', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300, 0), Buffer.from('DOS mode')]);
    await expect(start({ bytes: exe, fileName: 'extrato.xlsx' })).rejects.toBeInstanceOf(
      UnsupportedMediaTypeError,
    );
    expect(parser.calls).toEqual([]);
  });

  it('rejects a file over 10 MB (413) and an empty one', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0x61);
    await expect(start({ bytes: big })).rejects.toBeInstanceOf(PayloadTooLargeError);
    await expect(start({ bytes: Buffer.alloc(0) })).rejects.toBeInstanceOf(
      UnsupportedMediaTypeError,
    );
    expect(parser.calls).toEqual([]);
  });

  it('stores the file encrypted under its SHA-256, in the pool’s folder', async () => {
    const secret = Buffer.from('Data;Descrição;Valor\n05-01-2026;SALARIO ACME 1500,00;1500,00\n');
    await start({ bytes: secret });
    const folder = join(world.importsKit.storageDir, s.poolA);
    const names = await readdir(folder);
    expect(names).toEqual([`${sha(secret)}.bin`]);
    const onDisk = await readFile(join(folder, names[0] ?? ''));
    expect(onDisk.includes(Buffer.from('SALARIO'))).toBe(false);
    expect(onDisk.includes(Buffer.from('ACME'))).toBe(false);
  });

  it('cleans the file name', async () => {
    const result = await preview({ fileName: 'C:\\Users\\rui\\extrato.csv' });
    expect(result.fileName).toBe('extrato.csv');
  });

  it.each([
    ['an unknown field', { surprise: '1' }],
    ['a pool id', { poolId: '0198f000-0000-7000-8000-000000000001' }],
    ['an account that is not a uuid', { accountId: 'abc' }],
    ['both a parser and a mapping', { parserId: 'x', spec: { id: 'y' } }],
    ['a parser id with spaces', { parserId: 'not valid' }],
    ['a mapping that is not an object', { spec: 'text' }],
  ])('refuses %s (400)', async (_name, fields) => {
    await expect(start({ fields })).rejects.toBeInstanceOf(ValidationError);
    expect(parser.calls).toEqual([]);
  });

  it('refuses an account of another pool (400) and nothing is stored', async () => {
    const foreign = await makeAccount('Outra', {}, s.poolB);
    await expect(start({ fields: { accountId: foreign.id } })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(parser.calls).toEqual([]);
  });
});

// ----------------------------------------------------------------------------- recognition

describe('imports service: recognising the format', () => {
  it('uses the best format when it is sure and clearly ahead', async () => {
    parser.candidates = [candidate('weak', 0.5), candidate('strong', 0.95)];
    const result = await preview();
    expect(result.parser).toMatchObject({ parserId: 'strong', confidence: 0.95 });
    expect(parser.calls).toEqual(['detect', 'parse:strong']);
  });

  it('asks the user when two formats fit about equally', async () => {
    parser.candidates = [candidate('one', 0.92), candidate('two', 0.9)];
    const result = await start();
    expect(result).toMatchObject({ status: 'choose-parser' });
    expect(result.status === 'choose-parser' && result.candidates.map((c) => c.parserId)).toEqual([
      'one',
      'two',
    ]);
    expect(parser.calls).toEqual(['detect']);
  });

  it('asks the user when the only format is a weak one', async () => {
    parser.candidates = [candidate('weak', 0.55)];
    expect((await start()).status).toBe('choose-parser');
  });

  it('reads the file with the format the user chose', async () => {
    parser.candidates = [candidate('one', 0.92), candidate('two', 0.9)];
    const result = await preview({ fields: { parserId: 'two' } });
    expect(result.parser.parserId).toBe('two');
    expect(parser.calls).toEqual(['parse:two']);
  });

  it('proposes a column mapping for a csv no format recognises', async () => {
    parser.candidates = [];
    parser.proposal = {
      spec: { id: 'generic-csv-1', version: 1 },
      header: ['Data', 'Descrição', 'Valor'],
      preview: responseOf([bankRow('2026-01-05', 'Coffee', '-1.2', '98.8')], { reconciled: true }),
    };
    const result = await start();
    expect(result).toMatchObject({
      status: 'needs-mapping',
      spec: { id: 'generic-csv-1' },
      header: ['Data', 'Descrição', 'Valor'],
      preview: { rowCount: 1, reconciled: true, rows: [{ description: 'Coffee', amount: '-1.2' }] },
    });
    expect(await transactionCount()).toBe(0);
  });

  it('refuses a pdf no format recognises (422)', async () => {
    parser.candidates = [];
    await expect(
      start({ bytes: Buffer.from('%PDF-1.7 hello'), fileName: 'extrato.pdf' }),
    ).rejects.toBeInstanceOf(UnprocessableError);
  });

  it('reads the file with the mapping the user confirmed and keeps it on the batch', async () => {
    const spec = { id: 'generic-csv-1', version: 1 };
    const result = await preview({ fields: { spec } });
    expect(parser.calls).toEqual(['spec']);
    expect(parser.lastSpec).toEqual(spec);
    expect(result.parser.parserId).toBe('fake-parser');
  });

  it('answers with the strict start schema in every case', async () => {
    expect(() => ImportStartDto.parse(undefined)).toThrow();
    const result = await start();
    expect(ImportStartDto.safeParse(result).success).toBe(true);
  });
});

// ------------------------------------------------------------------------------ the preview

describe('imports service: the preview', () => {
  it('shows every line and writes nothing to the ledger', async () => {
    const account = await makeAccount('BPI');
    bankFile(bankRow('2026-01-05', 'Coffee', '-1.20'), bankRow('2026-01-06', 'Salary', '1500.00'));
    const result = await preview({ fields: { accountId: account.id } });
    expect(result).toMatchObject({
      status: 'preview',
      kind: 'bank',
      accountId: account.id,
      summary: { total: 2, new: 2, duplicates: 0, skipped: 0 },
      rowsTruncated: false,
    });
    expect(result.rows.map((row) => row.kind === 'bank' && row.duplicate)).toEqual([false, false]);
    expect(await ledger(account.id)).toHaveLength(0);
  });

  it('does not know the duplicates until an account is chosen, then marks them', async () => {
    const account = await makeAccount('BPI');
    bankFile(bankRow('2026-01-05', 'Coffee', '-1.20'));
    const first = await preview();
    expect(first.summary).toMatchObject({ total: 1, new: 1, duplicates: null });
    await commit(first.batchId, { accountId: account.id });

    const second = await preview();
    const again = await world.imports.get(await s.as('owner'), s.poolA, second.batchId, {
      accountId: account.id,
    });
    expect(again.summary).toMatchObject({ total: 1, new: 0, duplicates: 1 });
    expect(again.rows[0]).toMatchObject({ duplicate: true });
  });

  it('reports a file that was imported before (same SHA-256)', async () => {
    const account = await makeAccount('BPI');
    const first = await preview({ fields: { accountId: account.id } });
    expect(first.duplicateFile).toBeNull();
    await commit(first.batchId, { accountId: account.id });
    const second = await preview({ fields: { accountId: account.id } });
    expect(second.duplicateFile).not.toBeNull();
    expect(second.summary).toMatchObject({ new: 0, duplicates: 1 });
  });

  it('suggests the category the pool’s rules give and flags internal transfers', async () => {
    const owner = await s.as('owner');
    const { categories } = await world.categories.list(owner, s.poolA);
    const food =
      categories.find((c) => c.systemKey === 'food') ??
      categories.find((c) => c.kind === 'expense');
    expect(food).toBeDefined();
    await world.rules.create(owner, s.poolA, { keyword: 'CONTINENTE', categoryId: food?.id });
    const checking = await makeAccount('BPI');
    const savings = await makeAccount('Poupança', { type: 'savings' });
    // The other side of the transfer is already in the savings account.
    await world.transactions.create(owner, s.poolA, {
      accountId: savings.id,
      date: '2026-01-06',
      description: 'ENTRADA',
      amount: '200.00',
    });
    bankFile(
      bankRow('2026-01-05', 'COMPRA CONTINENTE', '-30.00'),
      bankRow('2026-01-05', 'TRF PARA POUPANCA', '-200.00'),
    );
    const result = await preview({ fields: { accountId: checking.id } });
    const [shop, transfer] = result.rows;
    expect(shop).toMatchObject({ kind: 'bank', categoryId: food?.id, transferPair: false });
    expect(transfer).toMatchObject({ kind: 'bank', transferPair: true });
  });

  it('flags lines the ledger cannot hold and counts them as skipped', async () => {
    bankFile(bankRow('2026-01-05', 'Odd', '0.12345'), bankRow('2026-01-05', 'Fine', '-1.20'));
    const result = await preview();
    expect(result.summary).toMatchObject({ total: 2, new: 1, skipped: 1 });
    expect(result.rows[0]).toMatchObject({ valid: false });
  });

  it('truncates a very long preview to 2000 lines but keeps them all for the commit', async () => {
    const account = await makeAccount('BPI');
    const many = Array.from({ length: 2100 }, (_, n) =>
      bankRow('2026-01-05', `Movimento ${n}`, '-1.00'),
    );
    bankFile(...many);
    const result = await preview({ fields: { accountId: account.id } });
    expect(result.rows).toHaveLength(2000);
    expect(result.rowsTruncated).toBe(true);
    const done = await commit(result.batchId, { accountId: account.id });
    expect(done.inserted).toBe(2100);
  });

  it('refuses the preview of a settled batch (409) and of a batch of another pool (404)', async () => {
    const account = await makeAccount('BPI');
    const result = await preview();
    await commit(result.batchId, { accountId: account.id });
    await expect(
      world.imports.get(await s.as('owner'), s.poolA, result.batchId),
    ).rejects.toBeInstanceOf(ConflictError);
    const mine = await preview();
    await expect(
      world.imports.get(await s.as('outsider'), s.poolB, mine.batchId),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.imports.get(await s.as('owner'), s.poolA, 'not-a-uuid'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// -------------------------------------------------------------------------------- the commit

describe('imports service: commit (bank)', () => {
  it('importing the same file twice adds 0 rows the second time', async () => {
    const account = await makeAccount('BPI');
    bankFile(bankRow('2026-01-05', 'Coffee', '-1.20'), bankRow('2026-01-06', 'Salary', '1500.00'));
    const first = await commit((await preview()).batchId, { accountId: account.id });
    expect(first).toMatchObject({ status: 'committed', inserted: 2, duplicates: 0, skipped: 0 });
    const second = await commit((await preview()).batchId, { accountId: account.id });
    expect(second).toMatchObject({ inserted: 0, duplicates: 2 });
    expect(await ledger(account.id)).toHaveLength(2);
  });

  it('two identical real lines in one file are both kept, and re-import adds neither', async () => {
    const account = await makeAccount('BPI');
    bankFile(bankRow('2026-01-05', 'Coffee', '-1.20'), bankRow('2026-01-05', 'Coffee', '-1.20'));
    expect((await commit((await preview()).batchId, { accountId: account.id })).inserted).toBe(2);
    expect((await commit((await preview()).batchId, { accountId: account.id })).inserted).toBe(0);
    expect(await ledger(account.id)).toHaveLength(2);
  });

  it('keeps a note and a category chosen by hand when the file comes again', async () => {
    const owner = await s.as('owner');
    const account = await makeAccount('BPI');
    const { categories } = await world.categories.list(owner, s.poolA);
    const chosen = categories.find((c) => c.kind === 'expense');
    bankFile(bankRow('2026-01-05', 'Coffee', '-1.20'));
    await commit((await preview()).batchId, { accountId: account.id });
    const [line] = await ledger(account.id);
    await world.notes.setTransactionNote(owner, s.poolA, line?.id ?? '', { note: 'with Ana' });
    await world.transactions.update(owner, s.poolA, line?.id ?? '', { categoryId: chosen?.id });
    await commit((await preview()).batchId, { accountId: account.id });
    const [after] = await ledger(account.id);
    expect(after).toMatchObject({ note: 'with Ana', categoryId: chosen?.id });
  });

  it('gives new lines the category the rules choose and pairs the transfers they complete', async () => {
    const owner = await s.as('owner');
    const { categories } = await world.categories.list(owner, s.poolA);
    const food = categories.find((c) => c.kind === 'expense');
    await world.rules.create(owner, s.poolA, { keyword: 'CONTINENTE', categoryId: food?.id });
    const checking = await makeAccount('BPI');
    const savings = await makeAccount('Poupança', { type: 'savings' });
    await world.transactions.create(owner, s.poolA, {
      accountId: savings.id,
      date: '2026-01-06',
      description: 'ENTRADA',
      amount: '200.00',
    });
    bankFile(
      bankRow('2026-01-05', 'COMPRA CONTINENTE', '-30.00'),
      bankRow('2026-01-05', 'TRF PARA POUPANCA', '-200.00'),
    );
    const done = await commit((await preview()).batchId, { accountId: checking.id });
    expect(done).toMatchObject({ inserted: 2, transfersPaired: 1 });
    expect(done.categorized).toBeGreaterThanOrEqual(1);
    const lines = await ledger(checking.id);
    expect(lines.find((l) => l.description === 'COMPRA CONTINENTE')?.categoryId).toBe(food?.id);
    expect(lines.find((l) => l.description === 'TRF PARA POUPANCA')?.transfer).toBe(true);
  });

  it('adjusts the opening balance to the statement when asked', async () => {
    const account = await makeAccount('BPI', { opening: '100' });
    bankFile(
      bankRow('2026-01-05', 'Coffee', '-1.20', '498.80'),
      bankRow('2026-01-06', 'Pay', '500', '998.80'),
    );
    parser.response = responseOf(parser.response.rows, {
      closing_balance: '998.80',
      reconciled: true,
    });
    const done = await commit((await preview()).batchId, {
      accountId: account.id,
      adjustOpeningBalance: true,
    });
    expect(done.openingBalanceAdjusted).toBe(true);
    const updated = await world.accounts.get(await s.as('owner'), s.poolA, account.id);
    expect(Number(updated.opening)).toBeCloseTo(500, 6); // 998.80 - (-1.20 + 500)
  });

  it('refuses to adjust the opening balance when the statement has no closing balance', async () => {
    const account = await makeAccount('BPI');
    const result = await preview();
    await expect(
      commit(result.batchId, { accountId: account.id, adjustOpeningBalance: true }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await ledger(account.id)).toHaveLength(0); // nothing was written
  });

  it('skips lines the ledger cannot hold and reports them', async () => {
    const account = await makeAccount('BPI');
    bankFile(bankRow('2026-01-05', 'Odd', '0.12345'), bankRow('2026-01-05', 'Fine', '-1.20'));
    const done = await commit((await preview()).batchId, { accountId: account.id });
    expect(done).toMatchObject({ inserted: 1, skipped: 1 });
  });

  it('is all or nothing: a failure rolls every line back', async () => {
    const account = await makeAccount('BPI');
    const result = await preview();
    await expect(
      commit(result.batchId, { accountId: account.id, adjustOpeningBalance: true }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await ledger(account.id)).toHaveLength(0);
    // The batch is still pending and can be committed properly.
    expect((await commit(result.batchId, { accountId: account.id })).inserted).toBe(1);
  });
});

describe('imports service: commit guards', () => {
  it('a batch of another pool answers 404 and is not touched', async () => {
    const account = await makeAccount('BPI');
    const mine = await preview();
    const theirAccount = await makeAccount('Outra', {}, s.poolB);
    await expect(
      commit(mine.batchId, { accountId: theirAccount.id }, 'outsider', s.poolB),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      commit(mine.batchId, { accountId: account.id }, 'outsider', s.poolA),
    ).rejects.toBeInstanceOf(NotFoundError); // not a member of A
    expect((await commit(mine.batchId, { accountId: account.id })).inserted).toBe(1);
  });

  it('needs imports.run (viewer 403), a session (401) and a strict body (400)', async () => {
    const account = await makeAccount('BPI');
    const result = await preview();
    await expect(
      commit(result.batchId, { accountId: account.id }, 'viewer'),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      world.imports.commit(new Headers(), s.poolA, result.batchId, { accountId: account.id }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    for (const body of [
      {},
      { accountId: 'abc' },
      { accountId: account.id, poolId: s.poolA },
      { accountId: account.id, status: 'committed' },
      { accountId: account.id, assets: { AAA: 'not a uuid' } },
    ]) {
      await expect(commit(result.batchId, body)).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it('refuses an account of another pool, and a second commit of the same batch (409)', async () => {
    const account = await makeAccount('BPI');
    const theirs = await makeAccount('Outra', {}, s.poolB);
    const result = await preview();
    await expect(commit(result.batchId, { accountId: theirs.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await commit(result.batchId, { accountId: account.id });
    await expect(commit(result.batchId, { accountId: account.id })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('a bank file cannot go to a brokerage account and the other way round', async () => {
    const broker = await makeAccount('XTB', { type: 'brokerage' });
    const bank = await makeAccount('BPI');
    const result = await preview();
    await expect(commit(result.batchId, { accountId: broker.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
    parser.candidates = [candidate('fake-broker', 0.95, 'broker')];
    bankFile(
      brokerRow({ type: 'buy', quantity: '1', price: '1', amount: '-1', external_id: 'x:1' }),
    );
    const trades = await preview();
    await expect(commit(trades.batchId, { accountId: bank.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('discard drops a pending batch (and only a pending one)', async () => {
    const account = await makeAccount('BPI');
    const result = await preview();
    await world.imports.discard(await s.as('owner'), s.poolA, result.batchId);
    await expect(commit(result.batchId, { accountId: account.id })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(
      world.imports.discard(await s.as('owner'), s.poolA, result.batchId),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      world.imports.discard(await s.as('viewer'), s.poolA, result.batchId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      world.imports.discard(await s.as('owner'), s.poolA, '0198f000-0000-7000-8000-00000000dead'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('imports service: the account remembers its format', () => {
  it('reuses the parser of the last import', async () => {
    const account = await makeAccount('BPI');
    parser.candidates = [candidate('bpi-xlsx', 0.95), candidate('other', 0.94)];
    const first = await preview({ fields: { accountId: account.id, parserId: 'other' } });
    await commit(first.batchId, { accountId: account.id });
    parser.calls = [];
    const next = await preview({ fields: { accountId: account.id } });
    expect(next).toMatchObject({ remembered: true, parser: { parserId: 'other' } });
    expect(parser.calls).toEqual(['detect', 'parse:other']);
  });

  it('reuses the column mapping the user confirmed', async () => {
    const account = await makeAccount('BPI');
    const spec = { id: 'generic-csv-1', version: 1 };
    const first = await preview({ fields: { accountId: account.id, spec } });
    await commit(first.batchId, { accountId: account.id });
    parser.calls = [];
    const next = await preview({ fields: { accountId: account.id } });
    expect(next.remembered).toBe(true);
    expect(parser.calls).toEqual(['spec']);
    expect(parser.lastSpec).toEqual(spec);
  });

  it('falls back to detection when the remembered mapping no longer fits', async () => {
    const account = await makeAccount('BPI');
    const spec = { id: 'generic-csv-1', version: 1 };
    await commit((await preview({ fields: { accountId: account.id, spec } })).batchId, {
      accountId: account.id,
    });
    parser.calls = [];
    parser.failSpec = new UnprocessableError();
    const next = await preview({ fields: { accountId: account.id } });
    expect(next.remembered).toBe(false);
    expect(parser.calls).toEqual(['spec', 'detect', 'parse:fake-parser']);
  });

  it('does not use what another pool’s account used', async () => {
    const theirs = await makeAccount('Outra', {}, s.poolB);
    parser.candidates = [candidate('theirs', 0.95)];
    const batch = await preview({
      as: 'outsider',
      poolId: s.poolB,
      fields: { accountId: theirs.id },
    });
    await commit(batch.batchId, { accountId: theirs.id }, 'outsider', s.poolB);
    parser.reset();
    const mine = await makeAccount('BPI');
    parser.calls = [];
    const next = await preview({ fields: { accountId: mine.id } });
    expect(next.remembered).toBe(false);
  });
});

describe('imports service: audit', () => {
  it('records uploads, commits and discards with ids and counts only', async () => {
    const account = await makeAccount('BPI');
    bankFile(bankRow('2026-01-05', 'SALARIO ACME 1500,00', '1500.00'));
    const one = await preview();
    await commit(one.batchId, { accountId: account.id });
    const two = await preview();
    await world.imports.discard(await s.as('owner'), s.poolA, two.batchId);
    const entries = await auditActions();
    expect(entries.map((e) => e.action)).toEqual([
      'import.uploaded',
      'import.committed',
      'import.uploaded',
      'import.discarded',
    ]);
    expect(entries[0]).toMatchObject({ target: one.batchId, meta: { count: 1 } });
    expect(entries[1]).toMatchObject({ target: one.batchId, meta: { count: 1 } });
    expect(JSON.stringify(entries)).not.toMatch(/SALARIO|ACME|1500/);
  });
});

// --------------------------------------------------------------------------------- broker

describe('imports service: broker files', () => {
  async function brokerSetup() {
    const owner = await s.as('owner');
    const portfolio = await world.portfolios.create(owner, s.poolA, {
      name: 'XTB',
      color: '#112233',
      currency: 'EUR',
    });
    const account = await makeAccount('XTB', {
      type: 'brokerage',
      currency: 'USD',
      portfolioId: portfolio.id,
      subAccounts: [{ name: 'Rui', holderId: null }],
    });
    parser.candidates = [candidate('fake-broker', 0.95, 'broker')];
    parser.response = responseOf([
      brokerRow({
        type: 'buy',
        quantity: '50',
        price: '10',
        amount: '-500',
        external_id: 'xtb:1',
        holder: 'Rui',
      }),
      brokerRow({ type: 'dividend', amount: '20.00', external_id: 'xtb:11' }),
      brokerRow({ type: 'tax', amount: '-3.00', external_id: 'xtb:10' }),
      brokerRow({ type: 'deposit', symbol: null, amount: '1000', external_id: 'xtb:2' }),
    ]);
    return { account, portfolio };
  }

  it('previews the symbols, the holders and the lines the import does not store yet', async () => {
    const { account, portfolio } = await brokerSetup();
    const result = await preview({ fields: { accountId: account.id } });
    expect(result).toMatchObject({
      kind: 'broker',
      summary: { total: 4, new: 3, duplicates: 0, skipped: 1 },
      broker: {
        symbols: [{ symbol: 'AAA.US', assetId: null }],
        holders: [{ holder: 'Rui' }],
        portfolioId: portfolio.id,
      },
    });
    expect(result.rows[3]).toMatchObject({ kind: 'broker', supported: false });
  });

  it('refuses to commit while a symbol has no asset, listing it, and writes nothing', async () => {
    const { account } = await brokerSetup();
    const result = await preview({ fields: { accountId: account.id } });
    const failure = await commit(result.batchId, { accountId: account.id }).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(ValidationError);
    expect((failure as ValidationError).issues).toEqual([
      { path: 'assets.AAA.US', message: 'choose or create the asset' },
    ]);
    const ops = await world.ops.list(await s.as('owner'), s.poolA, {});
    expect(ops.ops).toHaveLength(0);
  });

  it('creates the asset, writes buys and dividends (tax and refund grouped) and skips cash lines', async () => {
    const { account } = await brokerSetup();
    const result = await preview({ fields: { accountId: account.id } });
    const done = await commit(result.batchId, {
      accountId: account.id,
      newAssets: [
        { ticker: 'AAA', symbol: 'AAA.US', name: 'Alpha Exemplo', type: 'stock', currency: 'USD' },
      ],
    });
    expect(done).toMatchObject({ inserted: 2, duplicates: 0, skipped: 1, assetsCreated: 1 });
    const { ops } = await world.ops.list(await s.as('owner'), s.poolA, {});
    expect(ops.map((op) => [op.type, op.qty, op.gross, op.tax, op.amount])).toEqual(
      expect.arrayContaining([
        ['buy', '50', null, null, null],
        ['dividend', null, '20', '3', '17'],
      ]),
    );
    const buy = ops.find((op) => op.type === 'buy');
    expect(buy?.subAccountId).not.toBeNull(); // the sub-account named after the holder
  });

  it('re-importing the same report adds nothing (broker ids)', async () => {
    const { account } = await brokerSetup();
    const body = {
      accountId: account.id,
      newAssets: [
        { ticker: 'AAA', symbol: 'AAA.US', name: 'Alpha', type: 'stock', currency: 'USD' },
      ],
    };
    await commit((await preview({ fields: { accountId: account.id } })).batchId, body);
    const again = await preview({ fields: { accountId: account.id } });
    expect(again.summary).toMatchObject({ new: 0, duplicates: 3, skipped: 1 });
    const done = await commit(again.batchId, { accountId: account.id });
    expect(done).toMatchObject({ inserted: 0, duplicates: 2, assetsCreated: 0 });
    expect((await world.ops.list(await s.as('owner'), s.poolA, {})).ops).toHaveLength(2);
  });

  it('uses an asset the pool already has, matched by its symbol', async () => {
    const { account } = await brokerSetup();
    const asset = await world.assets.create(await s.as('owner'), s.poolA, {
      ticker: 'AAA',
      symbol: 'AAA.US',
      name: 'Alpha',
      type: 'stock',
      currency: 'USD',
    });
    const result = await preview({ fields: { accountId: account.id } });
    expect(result.broker?.symbols[0]?.assetId).toBe(asset.id);
    const done = await commit(result.batchId, { accountId: account.id });
    expect(done).toMatchObject({ inserted: 2, assetsCreated: 0 });
  });

  it('refuses a sub-account or an asset of another pool, and a missing portfolio', async () => {
    const { account } = await brokerSetup();
    const result = await preview({ fields: { accountId: account.id } });
    const foreignAsset = await world.assets.create(await s.as('outsider'), s.poolB, {
      ticker: 'AAA',
      symbol: 'AAA.US',
      name: 'Alpha',
      type: 'stock',
      currency: 'USD',
    });
    await expect(
      commit(result.batchId, { accountId: account.id, assets: { 'AAA.US': foreignAsset.id } }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      commit(result.batchId, {
        accountId: account.id,
        subAccounts: { Rui: '0198f000-0000-7000-8000-00000000beef' },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const loose = await makeAccount('Sem carteira', { type: 'brokerage', currency: 'USD' });
    await expect(commit(result.batchId, { accountId: loose.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
