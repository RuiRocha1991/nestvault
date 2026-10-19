import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CategoryDto,
  ConflictError,
  ForbiddenError,
  logger,
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

const list = async (as: Persona, poolId = s.poolA) =>
  (await world.categories.list(await s.as(as), poolId)).categories;
const create = async (as: Persona, body: unknown, poolId = s.poolA) =>
  world.categories.create(await s.as(as), poolId, body);
const update = async (as: Persona, id: string, body: unknown, poolId = s.poolA) =>
  world.categories.update(await s.as(as), poolId, id, body);
const remove = async (as: Persona, id: string, query?: unknown, poolId = s.poolA) =>
  world.categories.remove(await s.as(as), poolId, id, query);
const settings = async (as: Persona, id: string, body: unknown, poolId = s.poolA) =>
  world.categories.updateSettings(await s.as(as), poolId, id, body);

const globalOf = async (key: string) => {
  const found = (await list('owner')).find((category) => category.systemKey === key);
  if (!found) throw new Error(`No global category ${key}`);
  return found;
};

describe('categories service: reading', () => {
  it('gives every member the 25 global categories, with no name (i18n) and no copy in the table', async () => {
    for (const persona of ['owner', 'admin', 'member', 'viewer'] as const) {
      const categories = await list(persona);
      expect(categories).toHaveLength(25);
      for (const category of categories) {
        expect(CategoryDto.parse(category)).toEqual(category);
        expect(category).toMatchObject({
          global: true,
          name: null,
          monthlyBudget: null,
          hidden: false,
          colorOverride: null,
        });
        expect(category.systemKey).toMatch(/^[a-z][a-z-]+$/);
      }
    }
    // A pool with nobody inside it sees them too, and the table still holds 25 global rows.
    expect(await list('outsider', s.poolB)).toHaveLength(25);
    const count = await world.database.asMigrator(
      async (pool) =>
        (await pool.query<{ n: number }>('select count(*)::int as n from categories')).rows,
    );
    expect(count).toEqual([{ n: 25 }]);
  });

  it('refuses a request without a session and hides the pool from a non-member', async () => {
    await expect(world.categories.list(new Headers(), s.poolA)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(list('outsider')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('categories service: a pool’s own categories', () => {
  it('lets owner and admin create one, shown after the catalogue, and refuses member and viewer', async () => {
    const created = await create('owner', { name: 'Cantina', kind: 'expense', color: '#112233' });
    expect(CategoryDto.parse(created)).toEqual(created);
    expect(created).toMatchObject({
      global: false,
      systemKey: null,
      name: 'Cantina',
      color: '#112233',
      kind: 'expense',
    });
    await create('admin', { name: 'Mesada', kind: 'income' });
    for (const persona of ['member', 'viewer'] as const) {
      await expect(create(persona, { name: 'X', kind: 'expense' })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    await expect(create('outsider', { name: 'X', kind: 'expense' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const categories = await list('viewer');
    expect(categories).toHaveLength(27);
    expect(categories.filter((category) => !category.global).map((c) => c.name)).toEqual([
      'Cantina',
      'Mesada',
    ]);
  });

  it('is invisible in another pool, and the name may repeat there but not twice in one pool', async () => {
    const mine = await create('owner', { name: 'Cantina', kind: 'expense' });
    expect((await list('outsider', s.poolB)).some((category) => category.id === mine.id)).toBe(
      false,
    );
    await create('outsider', { name: 'Cantina', kind: 'expense' }, s.poolB);
    await expect(create('owner', { name: 'Cantina', kind: 'income' })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await list('owner')).toHaveLength(26);
    expect(await list('outsider', s.poolB)).toHaveLength(26);
  });

  it('changes some fields and keeps the others', async () => {
    const created = await create('owner', { name: 'Cantina', kind: 'expense', color: '#112233' });
    const changed = await update('admin', created.id, { name: 'Refeitório', kind: 'income' });
    expect(changed).toMatchObject({ name: 'Refeitório', kind: 'income', color: '#112233' });
    for (const persona of ['member', 'viewer'] as const) {
      await expect(update(persona, created.id, { name: 'x' })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
  });

  it.each([
    ['a system key', { name: 'X', kind: 'expense', systemKey: 'groceries' }],
    ['the pool', { name: 'X', kind: 'expense', poolId: '0192f3a1-0000-7000-8000-000000000001' }],
    ['the id', { name: 'X', kind: 'expense', id: '0192f3a1-0000-7000-8000-000000000001' }],
    ['an unknown kind', { name: 'X', kind: 'gift' }],
    ['an empty name', { name: '  ', kind: 'expense' }],
    ['a name with a control character', { name: 'a\u0000b', kind: 'expense' }],
    ['a colour that is not #rrggbb', { name: 'X', kind: 'expense', color: 'red' }],
    ['no kind', { name: 'X' }],
  ])('rejects %s with 400', async (_name, body) => {
    await expect(create('owner', body)).rejects.toBeInstanceOf(ValidationError);
    expect(await list('owner')).toHaveLength(25);
  });

  it('stores injection payloads in the name literally', async () => {
    const payload = "'; DROP TABLE categories; --";
    const created = await create('owner', { name: payload, kind: 'expense' });
    expect(created.name).toBe(payload);
    expect(await list('owner')).toHaveLength(26);
  });

  it('never changes or deletes another pool’s category', async () => {
    const theirs = await create('outsider', { name: 'Da B', kind: 'expense' }, s.poolB);
    await expect(update('owner', theirs.id, { name: 'hijacked' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(remove('owner', theirs.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(update('owner', 'not-a-uuid', { name: 'x' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await list('outsider', s.poolB)).find((c) => c.id === theirs.id)?.name).toBe('Da B');
  });
});

describe('categories service: the global catalogue is read only for a pool', () => {
  it('answers 403 to an update or a delete of a global category, for every role that may write', async () => {
    const groceries = await globalOf('groceries');
    for (const persona of ['owner', 'admin'] as const) {
      await expect(update(persona, groceries.id, { name: 'hijacked' })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(remove(persona, groceries.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(await globalOf('groceries')).toEqual(groceries);
  });
});

describe('categories service: deleting', () => {
  it('lets owner and admin delete one of the pool’s own, and refuses member and viewer', async () => {
    const created = await create('owner', { name: 'Cantina', kind: 'expense' });
    for (const persona of ['member', 'viewer'] as const) {
      await expect(remove(persona, created.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
    await remove('admin', created.id);
    expect(await list('owner')).toHaveLength(25);
    await expect(remove('owner', created.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('checks the replacement: another category, visible to the pool', async () => {
    const created = await create('owner', { name: 'Cantina', kind: 'expense' });
    const theirs = await create('outsider', { name: 'Da B', kind: 'expense' }, s.poolB);
    await expect(remove('owner', created.id, { replacement: created.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(remove('owner', created.id, { replacement: theirs.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      remove('owner', created.id, { replacement: '0192f3a1-0000-7000-8000-000000000001' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(remove('owner', created.id, { replacement: 'nope' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(remove('owner', created.id, { extra: '1' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await list('owner')).toHaveLength(26);
    const groceries = await globalOf('groceries');
    await remove('owner', created.id, { replacement: groceries.id });
    expect(await list('owner')).toHaveLength(25);
  });

  it('takes the pool’s settings of the category along', async () => {
    const created = await create('owner', { name: 'Cantina', kind: 'expense' });
    await settings('owner', created.id, { monthlyBudget: '50' });
    await remove('owner', created.id);
    const left = await world.database.asMigrator(
      async (pool) =>
        (
          await pool.query<{ category_id: string }>(
            'select category_id from pool_category_settings',
          )
        ).rows,
    );
    expect(left).toEqual([]);
  });
});

describe('categories service: budget, colour and visibility per pool', () => {
  it('sets them for a global category, for this pool only', async () => {
    const groceries = await globalOf('groceries');
    const changed = await settings('admin', groceries.id, {
      monthlyBudget: '450.5',
      colorOverride: '#AABBCC',
      hidden: true,
    });
    expect(changed).toMatchObject({
      global: true,
      monthlyBudget: '450.5',
      color: '#AABBCC',
      colorOverride: '#AABBCC',
      hidden: true,
    });
    const mine = (await list('viewer')).find((category) => category.id === groceries.id);
    expect(mine).toEqual(changed);
    const theirs = (await list('outsider', s.poolB)).find(
      (category) => category.id === groceries.id,
    );
    expect(theirs).toMatchObject({ monthlyBudget: null, hidden: false, colorOverride: null });
    expect(theirs?.color).toBe(groceries.color);
  });

  it('keeps the fields left out and clears with null', async () => {
    const created = await create('owner', { name: 'Cantina', kind: 'expense', color: '#112233' });
    await settings('owner', created.id, { monthlyBudget: '10', hidden: true });
    const second = await settings('owner', created.id, { colorOverride: '#445566' });
    expect(second).toMatchObject({ monthlyBudget: '10', hidden: true, color: '#445566' });
    const cleared = await settings('owner', created.id, {
      monthlyBudget: null,
      colorOverride: null,
    });
    expect(cleared).toMatchObject({
      monthlyBudget: null,
      colorOverride: null,
      color: '#112233',
      hidden: true,
    });
  });

  it('lets owner and admin, refuses member and viewer, hides another pool’s categories', async () => {
    const groceries = await globalOf('groceries');
    for (const persona of ['member', 'viewer'] as const) {
      await expect(settings(persona, groceries.id, { hidden: true })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    await expect(settings('outsider', groceries.id, { hidden: true })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const theirs = await create('outsider', { name: 'Da B', kind: 'expense' }, s.poolB);
    await expect(settings('owner', theirs.id, { monthlyBudget: '1' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(settings('owner', 'not-a-uuid', { hidden: true })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(
      (await list('outsider', s.poolB)).find((c) => c.id === theirs.id)?.monthlyBudget,
    ).toBeNull();
  });

  it.each([
    ['a negative budget', { monthlyBudget: '-1' }],
    ['a budget with a comma', { monthlyBudget: '1,5' }],
    ['a budget as a number', { monthlyBudget: 10 }],
    ['a budget with 5 decimals', { monthlyBudget: '1.12345' }],
    ['a bad colour', { colorOverride: 'blue' }],
    ['hidden as a string', { hidden: 'yes' }],
    ['an unknown field', { poolId: '0192f3a1-0000-7000-8000-000000000001' }],
  ])('rejects %s with 400', async (_name, body) => {
    const groceries = await globalOf('groceries');
    await expect(settings('owner', groceries.id, body)).rejects.toBeInstanceOf(ValidationError);
    expect((await globalOf('groceries')).monthlyBudget).toBeNull();
  });

  it('writes audit entries that name only the id and a count', async () => {
    const groceries = await globalOf('groceries');
    await settings('owner', groceries.id, { monthlyBudget: '987.65', hidden: true });
    await create('owner', { name: 'Segredo SA', kind: 'expense' });
    const entries = await rows<{ action: string; target: string; meta: unknown }>(
      world.identity,
      sql`select action, target, meta from audit_log where action like 'category.%' and pool_id = ${s.poolA} order by at`,
    );
    expect(entries.map((entry) => entry.action)).toEqual([
      'category.settings_updated',
      'category.created',
    ]);
    expect(entries[0]?.meta).toEqual({ count: 2 });
    expect(JSON.stringify(entries)).not.toMatch(/987\.65|Segredo/);
  });
});
