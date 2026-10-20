import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ForbiddenError,
  logger,
  NotFoundError,
  TransactionDto,
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

const IBAN_B = 'PT50000201231234567890154';

const create = async (as: Persona, body: unknown, poolId = s.poolA) =>
  world.transactions.create(await s.as(as), poolId, body);
const list = async (as: Persona, query?: unknown, poolId = s.poolA) =>
  world.transactions.list(await s.as(as), poolId, query);
const update = async (as: Persona, id: string, body: unknown, poolId = s.poolA) =>
  world.transactions.update(await s.as(as), poolId, id, body);
const remove = async (as: Persona, id: string, poolId = s.poolA) =>
  world.transactions.remove(await s.as(as), poolId, id);

async function category(key: string, poolId = s.poolA, as: Persona = 'owner') {
  const found = (await world.categories.list(await s.as(as), poolId)).categories.find(
    (entry) => entry.systemKey === key,
  );
  if (!found) throw new Error(`No global category ${key}`);
  return found;
}

async function makeAccount(
  name: string,
  extra: Record<string, unknown> = {},
  poolId = s.poolA,
  as: Persona = 'owner',
) {
  const headers = await s.as(as);
  const [holder] = (await world.holders.list(headers, poolId)).holders;
  return world.accounts.create(headers, poolId, {
    type: 'checking',
    name,
    currency: 'EUR',
    holderIds: [holder?.id ?? ''],
    ...extra,
  });
}

const movement = (accountId: string, extra: Record<string, unknown> = {}) => ({
  accountId,
  date: '2026-03-10',
  description: 'COMPRA CONTINENTE',
  amount: '-12.5',
  ...extra,
});

describe('transactions service: recording', () => {
  it('lets owner, admin and member record a movement, and refuses viewer (403) and a non-member (404)', async () => {
    const account = await makeAccount('BPI');
    for (const persona of ['owner', 'admin', 'member'] as const) {
      const created = await create(persona, movement(account.id));
      expect(TransactionDto.parse(created)).toEqual(created);
      expect(created).toMatchObject({
        accountId: account.id,
        amount: '-12.5',
        kind: 'expense',
        transfer: false,
        manualCategory: false,
        pairId: null,
        note: null,
      });
    }
    await expect(create('viewer', movement(account.id))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(create('outsider', movement(account.id))).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.transactions.create(new Headers(), s.poolA, movement(account.id)),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect((await list('viewer')).transactions).toHaveLength(3);
  });

  it('refuses an account or a category of another pool, and never writes', async () => {
    const mine = await makeAccount('BPI');
    const theirs = await makeAccount('Da B', {}, s.poolB, 'outsider');
    const theirCategory = await world.categories.create(await s.as('outsider'), s.poolB, {
      name: 'Só da B',
      kind: 'expense',
    });
    await expect(create('owner', movement(theirs.id))).rejects.toBeInstanceOf(ValidationError);
    await expect(
      create('owner', movement(mine.id, { categoryId: theirCategory.id })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      create('owner', movement('0192f3a1-0000-7000-8000-000000000001')),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await list('owner')).transactions).toEqual([]);
  });

  it.each([
    ['an unknown field', { poolId: '0192f3a1-0000-7000-8000-000000000001' }],
    ['the hash', { hash: 'x' }],
    ['a pair', { pairId: '0192f3a1-0000-7000-8000-000000000001' }],
    ['the manual flag', { manualCategory: true }],
    ['an amount of zero', { amount: '0' }],
    ['an amount of 0.00', { amount: '-0.00' }],
    ['an amount with a comma', { amount: '1,5' }],
    ['an amount as a number', { amount: 1.5 }],
    ['an amount with 5 decimals', { amount: '1.12345' }],
    ['an empty description', { description: '  ' }],
    ['a description of 501 characters', { description: 'x'.repeat(501) }],
    ['a malformed date', { date: '10/03/2026' }],
  ])('rejects %s with 400', async (_name, patch) => {
    const account = await makeAccount('BPI');
    await expect(create('owner', movement(account.id, patch))).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect((await list('owner')).transactions).toEqual([]);
  });

  it('stores injection payloads in the description literally', async () => {
    const account = await makeAccount('BPI');
    const created = await create(
      'owner',
      movement(account.id, { description: "'; DROP TABLE transactions; --" }),
    );
    expect(created.description).toBe("'; DROP TABLE transactions; --");
    expect((await list('owner')).transactions).toHaveLength(1);
  });

  it('writes an audit entry that names only the id', async () => {
    const account = await makeAccount('BPI');
    const created = await create('owner', movement(account.id, { description: 'SEGREDO 99.99' }));
    const entries = await rows<{ action: string; target: string }>(
      world.identity,
      sql`select action, target from audit_log where action like 'transaction.%' and pool_id = ${s.poolA}`,
    );
    expect(entries).toEqual([{ action: 'transaction.created', target: created.id }]);
    expect(JSON.stringify(entries)).not.toMatch(/SEGREDO|99\.99/);
  });
});

describe('transactions service: the rules run after a write', () => {
  async function withRules() {
    const fuel = await category('fuel');
    const groceries = await category('groceries');
    const headers = await s.as('owner');
    await world.rules.create(headers, s.poolA, { keyword: 'REPSOL', categoryId: fuel.id });
    await world.rules.create(headers, s.poolA, { keyword: 'CONTINENTE', categoryId: groceries.id });
    return { fuel, groceries };
  }

  it('categorizes by keyword at the start of a word, as the prototype does', async () => {
    const { fuel, groceries } = await withRules();
    const account = await makeAccount('BPI');
    const cases: [string, string | null][] = [
      ['COMPRA REPSOL LISBOA', fuel.id],
      ['COMPRA CONTINENTE MODELO', groceries.id],
      ['compra repsol', fuel.id],
      ['COMPRA XREPSOL', null],
      ['SEM PALAVRA CONHECIDA', null],
    ];
    for (const [description, expected] of cases) {
      const created = await create('owner', movement(account.id, { description }));
      expect([description, created.categoryId]).toEqual([description, expected]);
      expect(created.manualCategory).toBe(false);
    }
  });

  it('keeps a category given by hand, and marks it as manual', async () => {
    const { fuel, groceries } = await withRules();
    const account = await makeAccount('BPI');
    const created = await create(
      'member',
      movement(account.id, { description: 'COMPRA REPSOL', categoryId: groceries.id }),
    );
    expect(created).toMatchObject({ categoryId: groceries.id, manualCategory: true });
    expect(created.categoryId).not.toBe(fuel.id);
  });

  it('marks a transfer to another own account by its IBAN, and a household alias as sent outside', async () => {
    await makeAccount('Ordenado');
    const savings = await makeAccount('Poupança', { type: 'savings', iban: IBAN_B });
    const other = (await world.accounts.list(await s.as('owner'), s.poolA)).accounts.find(
      (account) => account.name === 'Ordenado',
    );
    expect(savings.iban).toBe(IBAN_B);
    const transfer = await create(
      'owner',
      movement(other?.id ?? '', { description: `TRF PARA ${IBAN_B}`, amount: '-200' }),
    );
    expect(transfer).toMatchObject({ kind: 'transfer', transfer: true });
    expect(transfer.categoryId).toBe((await category('internal-transfer')).id);

    const person = await world.holders.create(await s.as('owner'), s.poolA, {
      name: 'Simão',
      aliases: ['simao rocha'],
    });
    expect(person.aliases).toEqual(['SIMAO ROCHA']);
    const out = await create(
      'owner',
      movement(other?.id ?? '', { description: 'TRF PARA SIMAO ROCHA', amount: '-30' }),
    );
    expect(out.categoryId).toBe((await category('external-transfers')).id);
    const back = await create(
      'owner',
      movement(other?.id ?? '', { description: 'TRF DE SIMAO ROCHA', amount: '30' }),
    );
    expect(back.categoryId).toBe((await category('refunds')).id);
    expect(back.kind).toBe('refund');
  });
});

describe('transactions service: transfers between own accounts', () => {
  it('pairs an outflow with the mirror inflow of another account within the window', async () => {
    const one = await makeAccount('Ordenado');
    const two = await makeAccount('Poupança');
    const out = await create(
      'owner',
      movement(one.id, { description: 'A', amount: '-150', date: '2026-03-10' }),
    );
    expect(out.transfer).toBe(false);
    const inn = await create(
      'owner',
      movement(two.id, { description: 'B', amount: '150', date: '2026-03-12' }),
    );
    expect(inn).toMatchObject({ transfer: true, kind: 'transfer', pairId: out.id });
    const outAfter = (await list('owner')).transactions.find((entry) => entry.id === out.id);
    expect(outAfter).toMatchObject({ transfer: true, kind: 'transfer', pairId: inn.id });
    const transferCategory = (await category('internal-transfer')).id;
    expect(outAfter?.categoryId).toBe(transferCategory);
  });

  it('does not pair across the window, in the same account, or in other currencies', async () => {
    const one = await makeAccount('Ordenado');
    const two = await makeAccount('Poupança');
    const usd = await makeAccount('Dólares', { currency: 'USD' });
    await create('owner', movement(one.id, { amount: '-80', date: '2026-03-10' }));
    const late = await create('owner', movement(two.id, { amount: '80', date: '2026-03-20' }));
    const same = await create('owner', movement(one.id, { amount: '80', date: '2026-03-10' }));
    const dollars = await create('owner', movement(usd.id, { amount: '80', date: '2026-03-10' }));
    for (const created of [late, same, dollars]) {
      expect(created).toMatchObject({ transfer: false, pairId: null });
    }
  });

  it('follows the pool’s own transfer window', async () => {
    await world.settings.update(await s.as('owner'), s.poolA, { transferWindowDays: 0 });
    const one = await makeAccount('Ordenado');
    const two = await makeAccount('Poupança');
    await create('owner', movement(one.id, { amount: '-60', date: '2026-03-10' }));
    const next = await create('owner', movement(two.id, { amount: '60', date: '2026-03-11' }));
    expect(next.pairId).toBeNull();
    const same = await create('owner', movement(two.id, { amount: '60', date: '2026-03-10' }));
    expect(same.pairId).not.toBeNull();
  });

  it('never pairs movements of different pools', async () => {
    const mine = await makeAccount('Minha');
    const theirs = await makeAccount('Deles', {}, s.poolB, 'outsider');
    await create('owner', movement(mine.id, { amount: '-33' }));
    const other = await create('outsider', movement(theirs.id, { amount: '33' }), s.poolB);
    expect(other.pairId).toBeNull();
  });
});

describe('transactions service: category and transfer by hand', () => {
  it('sets the category by hand, and hands it back to the rules with null', async () => {
    const fuel = await category('fuel');
    const groceries = await category('groceries');
    await world.rules.create(await s.as('owner'), s.poolA, {
      keyword: 'REPSOL',
      categoryId: fuel.id,
    });
    const account = await makeAccount('BPI');
    const created = await create('owner', movement(account.id, { description: 'COMPRA REPSOL' }));
    expect(created.categoryId).toBe(fuel.id);
    const manual = await update('member', created.id, { categoryId: groceries.id });
    expect(manual).toMatchObject({ categoryId: groceries.id, manualCategory: true });
    const back = await update('member', created.id, { categoryId: null });
    expect(back).toMatchObject({ categoryId: fuel.id, manualCategory: false });
  });

  it('refuses a category of another pool, an empty body, a viewer and another pool’s movement', async () => {
    const account = await makeAccount('BPI');
    const created = await create('owner', movement(account.id));
    const theirCategory = await world.categories.create(await s.as('outsider'), s.poolB, {
      name: 'Só da B',
      kind: 'expense',
    });
    await expect(
      update('owner', created.id, { categoryId: theirCategory.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(update('owner', created.id, {})).rejects.toBeInstanceOf(ValidationError);
    await expect(update('owner', created.id, { poolId: 'x' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(update('viewer', created.id, { transfer: true })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(update('outsider', created.id, { transfer: true })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const theirs = await makeAccount('Deles', {}, s.poolB, 'outsider');
    const other = await create('outsider', movement(theirs.id), s.poolB);
    await expect(update('owner', other.id, { transfer: true })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(update('owner', 'not-a-uuid', { transfer: true })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('fixes the transfer flag, which detection then leaves alone, and releases a pair', async () => {
    const one = await makeAccount('Ordenado');
    const two = await makeAccount('Poupança');
    const out = await create('owner', movement(one.id, { amount: '-70', date: '2026-03-10' }));
    const inn = await create('owner', movement(two.id, { amount: '70', date: '2026-03-10' }));
    expect(inn.pairId).toBe(out.id);

    const released = await update('owner', inn.id, { transfer: false });
    expect(released).toMatchObject({ transfer: false, transferLocked: true, pairId: null });
    const partner = (await list('owner')).transactions.find((entry) => entry.id === out.id);
    expect(partner?.pairId).toBeNull();

    // A new mirror movement does not pair with the locked one.
    const third = await create('owner', movement(one.id, { amount: '-70', date: '2026-03-10' }));
    expect(third.pairId).toBeNull();
    const flagged = await update('owner', third.id, { transfer: true });
    expect(flagged).toMatchObject({ transfer: true, transferLocked: true });
  });

  it('turning a movement into the transfer category by hand makes it a transfer', async () => {
    const account = await makeAccount('BPI');
    const created = await create('owner', movement(account.id));
    const changed = await update('owner', created.id, {
      categoryId: (await category('internal-transfer')).id,
    });
    expect(changed).toMatchObject({ transfer: true, kind: 'transfer', manualCategory: true });
  });
});

describe('transactions service: deleting', () => {
  it('lets owner, admin and member delete, refuses viewer, and releases the other side of a transfer', async () => {
    const one = await makeAccount('Ordenado');
    const two = await makeAccount('Poupança');
    const out = await create('owner', movement(one.id, { amount: '-90' }));
    const inn = await create('owner', movement(two.id, { amount: '90' }));
    await expect(remove('viewer', out.id)).rejects.toBeInstanceOf(ForbiddenError);
    await remove('member', out.id);
    const left = (await list('owner')).transactions;
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ id: inn.id, pairId: null });
    await expect(remove('owner', out.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('never deletes a movement of another pool', async () => {
    const theirs = await makeAccount('Deles', {}, s.poolB, 'outsider');
    const other = await create('outsider', movement(theirs.id), s.poolB);
    await expect(remove('owner', other.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await list('outsider', undefined, s.poolB)).transactions).toHaveLength(1);
  });

  it('blocks deleting an account that has movements, and a category that has them', async () => {
    const account = await makeAccount('BPI');
    const own = await world.categories.create(await s.as('owner'), s.poolA, {
      name: 'Cantina',
      kind: 'expense',
    });
    const created = await create('owner', movement(account.id, { categoryId: own.id }));
    await expect(
      world.accounts.remove(await s.as('owner'), s.poolA, account.id),
    ).rejects.toMatchObject({ status: 409 });
    // The category needs a replacement while a movement uses it, and the movement moves there.
    await expect(
      world.categories.remove(await s.as('owner'), s.poolA, own.id),
    ).rejects.toBeInstanceOf(ValidationError);
    const groceries = await category('groceries');
    await world.categories.remove(await s.as('owner'), s.poolA, own.id, {
      replacement: groceries.id,
    });
    const moved = (await list('owner')).transactions.find((entry) => entry.id === created.id);
    expect(moved?.categoryId).toBe(groceries.id);
    await remove('owner', created.id);
    await world.accounts.remove(await s.as('owner'), s.poolA, account.id);
  });
});

describe('transactions service: listing', () => {
  async function seedList() {
    const one = await makeAccount('Ordenado');
    const two = await makeAccount('Poupança');
    const groceries = await category('groceries');
    const entries = [
      { accountId: one.id, date: '2026-03-01', description: 'ORDENADO', amount: '1500' },
      {
        accountId: one.id,
        date: '2026-03-05',
        description: 'COMPRA CONTINENTE',
        amount: '-40',
        categoryId: groceries.id,
      },
      { accountId: one.id, date: '2026-03-05', description: 'PAGO 50% DESCONTO', amount: '-10' },
      { accountId: two.id, date: '2026-04-02', description: 'COMPRA_X', amount: '-5' },
      { accountId: two.id, date: '2026-04-03', description: 'REEMBOLSO', amount: '20.25' },
    ];
    for (const entry of entries) await create('owner', entry);
    return { one, two, groceries };
  }
  const names = async (query: Record<string, unknown>, as: Persona = 'viewer') =>
    (await list(as, query)).transactions.map((entry) => entry.description);

  it('filters by month, account, category, kind and text, for every member', async () => {
    const { one, groceries } = await seedList();
    expect(await names({ month: '2026-04' })).toEqual(['REEMBOLSO', 'COMPRA_X']);
    expect(await names({ accountId: one.id })).toHaveLength(3);
    expect(await names({ categoryId: groceries.id })).toEqual(['COMPRA CONTINENTE']);
    expect(await names({ categoryId: 'none' })).toHaveLength(4);
    expect(await names({ kind: 'income' })).toEqual(['REEMBOLSO', 'ORDENADO']);
    expect(await names({ q: '50%' })).toEqual(['PAGO 50% DESCONTO']);
    expect(await names({ q: '_' })).toEqual(['COMPRA_X']);
    expect(await names({ q: "' OR 1=1 --" })).toEqual([]);
    expect(await names({ withNotes: 'true' })).toEqual([]);
    for (const persona of ['owner', 'admin', 'member', 'viewer'] as const) {
      expect(await names({ month: '2026-03' }, persona)).toHaveLength(3);
    }
  });

  it('sorts by an allow-listed column and refuses anything else with 400', async () => {
    await seedList();
    expect(await names({ sort: 'amount', order: 'asc' })).toEqual([
      'COMPRA CONTINENTE',
      'PAGO 50% DESCONTO',
      'COMPRA_X',
      'REEMBOLSO',
      'ORDENADO',
    ]);
    expect((await names({ sort: 'description', order: 'asc' }))[0]).toBe('COMPRA CONTINENTE');
    for (const sort of ['amount;drop table', 'poolId', 'hash', 'amount desc', '']) {
      await expect(list('owner', { sort })).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(list('owner', { order: 'sideways' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects bad filters, an unknown parameter and a limit out of range with 400', async () => {
    await seedList();
    for (const query of [
      { month: '2026-13' },
      { month: 'march' },
      { accountId: 'x' },
      { categoryId: 'x' },
      { kind: 'gift' },
      { q: '' },
      { withNotes: 'maybe' },
      { limit: '0' },
      { limit: '201' },
      { limit: 'ten' },
      { poolId: s.poolB },
    ]) {
      await expect(list('owner', query)).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it('pages with a cursor to the end without gaps, and refuses a cursor of another sort', async () => {
    await seedList();
    const ids: string[] = [];
    let cursor: string | undefined;
    for (let turn = 0; turn < 10; turn += 1) {
      const result = await list('viewer', { limit: '2', ...(cursor ? { cursor } : {}) });
      ids.push(...result.transactions.map((entry) => entry.id));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    const first = await list('viewer', { limit: '2' });
    await expect(
      list('viewer', { limit: '2', sort: 'amount', cursor: first.nextCursor }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      list('viewer', { limit: '2', order: 'asc', cursor: first.nextCursor }),
    ).rejects.toBeInstanceOf(ValidationError);
    for (const bad of ['nope', Buffer.from('{"s":"date"}').toString('base64url'), 'e30']) {
      await expect(list('viewer', { cursor: bad })).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it('never lists the movements of another pool, and refuses a non-member', async () => {
    await seedList();
    const theirs = await makeAccount('Deles', {}, s.poolB, 'outsider');
    await create('outsider', movement(theirs.id, { description: 'SÓ DA B' }), s.poolB);
    expect((await names({})).includes('SÓ DA B')).toBe(false);
    expect((await list('outsider', {}, s.poolB)).transactions.map((e) => e.description)).toEqual([
      'SÓ DA B',
    ]);
    await expect(list('outsider')).rejects.toBeInstanceOf(NotFoundError);
    await expect(world.transactions.list(new Headers(), s.poolA)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});
