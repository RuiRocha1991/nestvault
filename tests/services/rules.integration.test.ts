import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApplyRulesDto,
  ForbiddenError,
  logger,
  NotFoundError,
  RuleDto,
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

const create = async (as: Persona, body: unknown, poolId = s.poolA) =>
  world.rules.create(await s.as(as), poolId, body);
const list = async (as: Persona, poolId = s.poolA) =>
  (await world.rules.list(await s.as(as), poolId)).rules;
const update = async (as: Persona, id: string, body: unknown, poolId = s.poolA) =>
  world.rules.update(await s.as(as), poolId, id, body);
const apply = async (as: Persona, confirm: boolean, poolId = s.poolA) =>
  world.rules.apply(await s.as(as), poolId, { confirm });

async function category(key: string, poolId = s.poolA, as: Persona = 'owner') {
  const found = (await world.categories.list(await s.as(as), poolId)).categories.find(
    (entry) => entry.systemKey === key,
  );
  if (!found) throw new Error(`No global category ${key}`);
  return found;
}

async function makeAccount(name: string, poolId = s.poolA, as: Persona = 'owner') {
  const headers = await s.as(as);
  const [holder] = (await world.holders.list(headers, poolId)).holders;
  return world.accounts.create(headers, poolId, {
    type: 'checking',
    name,
    currency: 'EUR',
    holderIds: [holder?.id ?? ''],
  });
}

describe('rules service: keyword rules', () => {
  it('lets owner and admin add a rule after the last, and refuses member and viewer', async () => {
    const fuel = await category('fuel');
    const first = await create('owner', { keyword: 'REPSOL', categoryId: fuel.id });
    expect(RuleDto.parse(first)).toEqual(first);
    expect(first).toMatchObject({
      keyword: 'REPSOL',
      categoryId: fuel.id,
      accountId: null,
      position: 1,
    });
    const second = await create('admin', { keyword: 'GALP', categoryId: fuel.id });
    expect(second.position).toBe(2);
    for (const persona of ['member', 'viewer'] as const) {
      await expect(create(persona, { keyword: 'BP', categoryId: fuel.id })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    await expect(create('outsider', { keyword: 'BP', categoryId: fuel.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    for (const persona of ['owner', 'admin', 'member', 'viewer'] as const) {
      expect((await list(persona)).map((rule) => rule.keyword)).toEqual(['REPSOL', 'GALP']);
    }
    await expect(world.rules.list(new Headers(), s.poolA)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('accepts a global or an own category and an account of the pool, and refuses another pool’s', async () => {
    const own = await world.categories.create(await s.as('owner'), s.poolA, {
      name: 'Cantina',
      kind: 'expense',
    });
    const theirCategory = await world.categories.create(await s.as('outsider'), s.poolB, {
      name: 'Só da B',
      kind: 'expense',
    });
    const account = await makeAccount('BPI');
    const theirAccount = await makeAccount('Deles', s.poolB, 'outsider');
    const fuel = await category('fuel');
    expect(await create('owner', { keyword: 'CANTINA', categoryId: own.id })).toMatchObject({
      categoryId: own.id,
    });
    expect(
      await create('owner', { keyword: 'GALP', categoryId: fuel.id, accountId: account.id }),
    ).toMatchObject({ accountId: account.id });
    await expect(
      create('owner', { keyword: 'XX', categoryId: theirCategory.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      create('owner', { keyword: 'XX', categoryId: fuel.id, accountId: theirAccount.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      create('owner', { keyword: 'XX', categoryId: '0192f3a1-0000-7000-8000-000000000001' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await list('owner')).toHaveLength(2);
  });

  it.each([
    ['a keyword of one character', { keyword: 'x' }],
    ['a keyword of 61 characters', { keyword: 'x'.repeat(61) }],
    ['no category', { categoryId: undefined }],
    ['an unknown field', { poolId: '0192f3a1-0000-7000-8000-000000000001' }],
    ['a position', { position: 1 }],
  ])('rejects %s with 400', async (_name, patch) => {
    const fuel = await category('fuel');
    await expect(
      create('owner', { keyword: 'REPSOL', categoryId: fuel.id, ...patch }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await list('owner')).toEqual([]);
  });

  it('stores injection payloads in the keyword literally', async () => {
    const fuel = await category('fuel');
    const created = await create('owner', {
      keyword: "'; DROP TABLE category_rules; --",
      categoryId: fuel.id,
    });
    expect(created.keyword).toBe("'; DROP TABLE category_rules; --");
    expect(await list('owner')).toHaveLength(1);
  });

  it('changes some fields, and never touches another pool’s rule', async () => {
    const fuel = await category('fuel');
    const groceries = await category('groceries');
    const account = await makeAccount('BPI');
    const rule = await create('owner', {
      keyword: 'REPSOL',
      categoryId: fuel.id,
      accountId: account.id,
    });
    const changed = await update('admin', rule.id, { categoryId: groceries.id, accountId: null });
    expect(changed).toMatchObject({ keyword: 'REPSOL', categoryId: groceries.id, accountId: null });
    for (const persona of ['member', 'viewer'] as const) {
      await expect(update(persona, rule.id, { keyword: 'X1' })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    const theirFuel = await category('fuel', s.poolB, 'outsider');
    const theirs = await create('outsider', { keyword: 'GALP', categoryId: theirFuel.id }, s.poolB);
    await expect(update('owner', theirs.id, { keyword: 'HIJACKED' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      world.rules.remove(await s.as('owner'), s.poolA, theirs.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await list('outsider', s.poolB))[0]?.keyword).toBe('GALP');
    await expect(update('owner', 'not-a-uuid', { keyword: 'XX' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('deletes a rule, and the rules of an account go with the account', async () => {
    const fuel = await category('fuel');
    const account = await makeAccount('BPI');
    const rule = await create('owner', { keyword: 'REPSOL', categoryId: fuel.id });
    await create('owner', { keyword: 'GALP', categoryId: fuel.id, accountId: account.id });
    await expect(world.rules.remove(await s.as('viewer'), s.poolA, rule.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await world.rules.remove(await s.as('admin'), s.poolA, rule.id);
    expect(await list('owner')).toHaveLength(1);
    await world.accounts.remove(await s.as('owner'), s.poolA, account.id);
    expect(await list('owner')).toEqual([]);
  });

  it('blocks deleting a category that rules use, unless a replacement takes them', async () => {
    const own = await world.categories.create(await s.as('owner'), s.poolA, {
      name: 'Cantina',
      kind: 'expense',
    });
    const rule = await create('owner', { keyword: 'CANTINA', categoryId: own.id });
    await expect(
      world.categories.remove(await s.as('owner'), s.poolA, own.id),
    ).rejects.toBeInstanceOf(ValidationError);
    const groceries = await category('groceries');
    await world.categories.remove(await s.as('owner'), s.poolA, own.id, {
      replacement: groceries.id,
    });
    expect((await list('owner')).find((entry) => entry.id === rule.id)?.categoryId).toBe(
      groceries.id,
    );
  });
});

describe('rules service: order', () => {
  async function three() {
    const fuel = await category('fuel');
    const make = (keyword: string) => create('owner', { keyword, categoryId: fuel.id });
    return [await make('UM'), await make('DOIS'), await make('TRES')] as const;
  }

  it('reorders the rules, and the first matching rule wins afterwards', async () => {
    const [um, dois, tres] = await three();
    const result = await world.rules.reorder(await s.as('admin'), s.poolA, {
      ids: [tres.id, um.id, dois.id],
    });
    expect(result.rules.map((rule) => [rule.keyword, rule.position])).toEqual([
      ['TRES', 1],
      ['UM', 2],
      ['DOIS', 3],
    ]);
    expect((await list('viewer')).map((rule) => rule.id)).toEqual([tres.id, um.id, dois.id]);

    const fuel = await category('fuel');
    const groceries = await category('groceries');
    const headers = await s.as('owner');
    const a = await world.rules.create(headers, s.poolA, { keyword: 'LOJA', categoryId: fuel.id });
    const b = await world.rules.create(headers, s.poolA, {
      keyword: 'LOJA',
      categoryId: groceries.id,
    });
    await world.rules.reorder(headers, s.poolA, { ids: [b.id, tres.id, um.id, dois.id, a.id] });
    const account = await makeAccount('BPI');
    const created = await world.transactions.create(headers, s.poolA, {
      accountId: account.id,
      date: '2026-03-10',
      description: 'COMPRA LOJA',
      amount: '-5',
    });
    expect(created.categoryId).toBe(groceries.id);
  });

  it('wants every rule of the pool exactly once', async () => {
    const [um, dois, tres] = await three();
    const theirFuel = await category('fuel', s.poolB, 'outsider');
    const theirs = await create('outsider', { keyword: 'GALP', categoryId: theirFuel.id }, s.poolB);
    const bad = [
      { ids: [um.id, dois.id] },
      { ids: [um.id, dois.id, tres.id, tres.id] },
      { ids: [um.id, dois.id, theirs.id] },
      { ids: [] },
      { ids: [um.id, dois.id, tres.id], extra: 1 },
      { ids: ['nope'] },
    ];
    for (const body of bad) {
      await expect(world.rules.reorder(await s.as('owner'), s.poolA, body)).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    expect((await list('owner')).map((rule) => rule.id)).toEqual([um.id, dois.id, tres.id]);
    expect((await list('outsider', s.poolB)).map((rule) => rule.id)).toEqual([theirs.id]);
    for (const persona of ['member', 'viewer'] as const) {
      await expect(
        world.rules.reorder(await s.as(persona), s.poolA, { ids: [um.id, dois.id, tres.id] }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe('rules service: apply to the existing movements', () => {
  async function seed() {
    const fuel = await category('fuel');
    const groceries = await category('groceries');
    const account = await makeAccount('BPI');
    const headers = await s.as('owner');
    const add = (description: string, extra: Record<string, unknown> = {}) =>
      world.transactions.create(headers, s.poolA, {
        accountId: account.id,
        date: '2026-03-10',
        description,
        amount: '-10',
        ...extra,
      });
    // The movements exist before the rules do: nothing has categorized them.
    const repsol = await add('COMPRA REPSOL LISBOA');
    const continente = await add('COMPRA CONTINENTE');
    const manual = await add('COMPRA REPSOL PORTO', { categoryId: groceries.id });
    const unknown = await add('SEM REGRA');
    await world.rules.create(headers, s.poolA, { keyword: 'REPSOL', categoryId: fuel.id });
    await world.rules.create(headers, s.poolA, { keyword: 'CONTINENTE', categoryId: groceries.id });
    return { fuel, groceries, repsol, continente, manual, unknown };
  }
  const categoryOf = async (id: string) =>
    (await world.transactions.list(await s.as('owner'), s.poolA)).transactions.find(
      (entry) => entry.id === id,
    )?.categoryId;

  it('previews without changing anything, then applies on confirmation', async () => {
    const { fuel, groceries, repsol, continente, manual, unknown } = await seed();
    const preview = await apply('admin', false);
    expect(ApplyRulesDto.parse(preview)).toEqual(preview);
    expect(preview).toMatchObject({ matched: 2, changed: 2, applied: false });
    expect(preview.changes.map((change) => change.description).sort()).toEqual([
      'COMPRA CONTINENTE',
      'COMPRA REPSOL LISBOA',
    ]);
    expect(await categoryOf(repsol.id)).toBeNull();

    const done = await apply('admin', true);
    expect(done).toMatchObject({ changed: 2, applied: true });
    expect(await categoryOf(repsol.id)).toBe(fuel.id);
    expect(await categoryOf(continente.id)).toBe(groceries.id);
    // A category chosen by hand survives, and a movement no rule matches stays as it is.
    expect(await categoryOf(manual.id)).toBe(groceries.id);
    expect(await categoryOf(unknown.id)).toBeNull();

    const again = await apply('owner', true);
    expect(again).toMatchObject({ matched: 2, changed: 0 });
  });

  it('refuses member and viewer and a non-member, and rejects a body that is not { confirm }', async () => {
    await seed();
    for (const persona of ['member', 'viewer'] as const) {
      await expect(apply(persona, false)).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(apply('outsider', false)).rejects.toBeInstanceOf(NotFoundError);
    for (const body of [
      {},
      { confirm: 'yes' },
      { confirm: true, force: true },
      { poolId: s.poolB },
    ]) {
      await expect(world.rules.apply(await s.as('owner'), s.poolA, body)).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
  });

  it('only touches the movements of its own pool', async () => {
    await seed();
    const theirFuel = await category('fuel', s.poolB, 'outsider');
    const theirAccount = await makeAccount('Deles', s.poolB, 'outsider');
    const theirHeaders = await s.as('outsider');
    const theirs = await world.transactions.create(theirHeaders, s.poolB, {
      accountId: theirAccount.id,
      date: '2026-03-10',
      description: 'COMPRA REPSOL FARO',
      amount: '-7',
    });
    await world.rules.create(theirHeaders, s.poolB, { keyword: 'GALP', categoryId: theirFuel.id });
    await apply('owner', true);
    const after = (await world.transactions.list(theirHeaders, s.poolB)).transactions.find(
      (entry) => entry.id === theirs.id,
    );
    expect(after?.categoryId).toBeNull();
  });

  it('applies the transfer category and flag the rules decide', async () => {
    const account = await makeAccount('BPI');
    const headers = await s.as('owner');
    const created = await world.transactions.create(headers, s.poolA, {
      accountId: account.id,
      date: '2026-03-10',
      description: 'PAGAMENTO POUPANCA',
      amount: '-100',
    });
    await world.rules.create(headers, s.poolA, {
      keyword: 'POUPANCA',
      categoryId: (await category('internal-transfer')).id,
    });
    await apply('owner', true);
    const after = (await world.transactions.list(headers, s.poolA)).transactions.find(
      (entry) => entry.id === created.id,
    );
    expect(after).toMatchObject({ transfer: true, kind: 'transfer' });
  });

  it('writes an audit entry with a count and no names', async () => {
    await seed();
    await apply('owner', true);
    const entries = await rows<{ action: string; meta: unknown }>(
      world.identity,
      sql`select action, meta from audit_log where action = 'rule.applied' and pool_id = ${s.poolA}`,
    );
    expect(entries).toEqual([{ action: 'rule.applied', meta: { count: 2 } }]);
  });
});
