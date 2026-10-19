import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { poolMembersRepo } from '@nestvault/db';
import {
  ConflictError,
  ForbiddenError,
  HOLDER_PALETTE,
  HolderDto,
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

const MEMBERS_OF_A: readonly Persona[] = ['owner', 'admin', 'member', 'viewer'];

const create = async (as: Persona, body: unknown, poolId = s.poolA) =>
  world.holders.create(await s.as(as), poolId, body);
const list = async (as: Persona, poolId = s.poolA) =>
  (await world.holders.list(await s.as(as), poolId)).holders;
/** The people added by hand: the members' own holders are not among them. */
const manual = async (as: Persona, poolId = s.poolA) =>
  (await list(as, poolId)).filter((holder) => holder.userId === null);

describe('holders service: members are people of the household', () => {
  it('lists every member of the pool without anybody adding them', async () => {
    const seen = await list('viewer');
    expect(seen).toHaveLength(MEMBERS_OF_A.length);
    expect(seen.map((holder) => holder.userId).sort()).toEqual(
      MEMBERS_OF_A.map((persona) => s.ids[persona]).sort(),
    );
    for (const holder of seen) {
      expect(holder).toMatchObject({ member: true, aliases: [] });
      expect(HolderDto.parse(holder)).toEqual(holder);
    }
    expect(seen.map((holder) => holder.name).sort()).toEqual([...MEMBERS_OF_A].sort());
    // Each one has a colour of its own.
    expect(new Set(seen.map((holder) => holder.color)).size).toBe(seen.length);
  });

  it('is idempotent and picks up a member who joins later', async () => {
    const first = await list('owner');
    expect(await list('owner')).toEqual(first);

    await poolMembersRepo.insert(world.identity.db, {
      poolId: s.poolA,
      userId: s.ids.newcomer,
      role: 'member',
    });
    const after = await list('owner');
    expect(after).toHaveLength(first.length + 1);
    expect(after.find((holder) => holder.userId === s.ids.newcomer)).toMatchObject({
      name: 'newcomer',
      member: true,
    });
    for (const holder of first) expect(after).toContainEqual(holder);
  });

  it('keeps the holder of a member who leaves, and then lets it be removed', async () => {
    const before = await list('owner');
    const viewerHolder = before.find((holder) => holder.userId === s.ids.viewer);
    expect(viewerHolder?.member).toBe(true);

    await world.members.remove(await s.as('owner'), s.poolA, s.ids.viewer);
    const after = await list('owner');
    const kept = after.find((holder) => holder.id === viewerHolder?.id);
    expect(kept).toMatchObject({ member: false, userId: s.ids.viewer });

    await world.holders.remove(await s.as('owner'), s.poolA, kept?.id ?? '');
    expect((await list('owner')).some((holder) => holder.id === kept?.id)).toBe(false);
  });

  it('refuses to remove the holder of a current member (409)', async () => {
    const mine = (await list('owner')).find((holder) => holder.userId === s.ids.member);
    await expect(
      world.holders.remove(await s.as('owner'), s.poolA, mine?.id ?? ''),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await list('owner')).some((holder) => holder.id === mine?.id)).toBe(true);
  });

  it('lets a member holder be renamed and recoloured without losing the link', async () => {
    const mine = (await list('owner')).find((holder) => holder.userId === s.ids.member);
    const renamed = await world.holders.update(await s.as('admin'), s.poolA, mine?.id ?? '', {
      name: 'Beto',
      aliases: ['beto silva'],
    });
    expect(renamed).toMatchObject({
      name: 'Beto',
      aliases: ['BETO SILVA'],
      userId: s.ids.member,
      member: true,
    });
  });

  it('never mixes the members of another pool into the list', async () => {
    const seenByB = await list('outsider', s.poolB);
    expect(seenByB.map((holder) => holder.userId).sort()).toEqual(
      [s.ids.outsider, s.ids.bMember].sort(),
    );
    const seenByA = await list('owner');
    expect(seenByA.some((holder) => seenByB.some((other) => other.id === holder.id))).toBe(false);
  });
});

describe('holders service: create', () => {
  it('adds a person without a login with a free palette colour and normalized aliases', async () => {
    const used = (await list('admin')).map((holder) => holder.color);
    const created = await create('admin', {
      name: '  Simão  ',
      aliases: ['joão   Sílva', 'JOAO SILVA'],
    });
    expect(HolderDto.parse(created)).toEqual(created);
    expect(created).toMatchObject({
      name: 'Simão',
      aliases: ['JOAO SILVA'],
      userId: null,
      member: false,
    });
    expect(HOLDER_PALETTE).toContain(created.color);
    expect(used).not.toContain(created.color);

    const explicit = await create('admin', { name: 'Eva', color: '#123abc' });
    expect(explicit.color).toBe('#123ABC');
  });

  it('keeps a colour free again once its holder is removed', async () => {
    const first = await create('owner', { name: 'Ana' });
    await world.holders.remove(await s.as('owner'), s.poolA, first.id);
    expect((await create('owner', { name: 'Rui' })).color).toBe(first.color);
  });

  it('links a new holder only to a member who has none, and refuses anybody else', async () => {
    // Every member already has a holder, so linking a second one is a conflict.
    await expect(create('owner', { name: 'Ana', userId: s.ids.member })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(create('owner', { name: 'Eva', userId: s.ids.outsider })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await manual('owner')).toEqual([]);
  });

  it('validates aliases and names', async () => {
    const bad: unknown[] = [
      { name: '' },
      { name: 'x'.repeat(61) },
      { name: 'Ana', aliases: ['ab'] },
      { name: 'Ana', aliases: ['x'.repeat(61)] },
      { name: 'Ana', aliases: Array.from({ length: 11 }, (_, i) => `ALIAS ${i}`) },
      { name: 'Ana', color: 'red' },
      { name: 'Ana', poolId: s.poolB },
      { name: 'Ana', id: s.poolB },
      {},
    ];
    for (const body of bad) {
      await expect(create('owner', body), JSON.stringify(body)).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    expect(await manual('owner')).toEqual([]);
  });

  it('stores an injection payload in the name and aliases literally', async () => {
    const created = await create('owner', {
      name: "' OR 1=1 --",
      aliases: ["'; DROP TABLE holders; --"],
    });
    expect(created.name).toBe("' OR 1=1 --");
    expect(created.aliases).toEqual(["'; DROP TABLE HOLDERS; --"]);
    expect(await manual('owner')).toHaveLength(1);
  });

  it('refuses a viewer and a member (403), a non-member (404) and no session (401)', async () => {
    await expect(create('viewer', { name: 'Ana' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(create('member', { name: 'Ana' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(create('outsider', { name: 'Ana' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.holders.create(new Headers(), s.poolA, { name: 'Ana' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(
      world.holders.create(await s.as('owner'), 'not-a-uuid', { name: 'Ana' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('records an audit entry with the holder id and nothing else', async () => {
    const created = await create('owner', { name: 'Ana Pessoa', aliases: ['ana pessoa'] });
    const entries = await rows<{ action: string; target: string; meta: unknown }>(
      world.identity,
      sql`select action, target, meta from audit_log where target = ${created.id}`,
    );
    expect(entries).toEqual([{ action: 'holder.created', target: created.id, meta: {} }]);
  });
});

describe('holders service: list, update, remove', () => {
  it('lists the people of the pool for any member, oldest first, never those of another pool', async () => {
    const one = await create('owner', { name: 'Ana' });
    const two = await create('owner', { name: 'Rui' });
    await create('outsider', { name: 'Bruno' }, s.poolB);

    const seen = await list('viewer');
    expect(seen.map((holder) => holder.id).slice(-2)).toEqual([one.id, two.id]);
    expect(seen.some((holder) => holder.name === 'Bruno')).toBe(false);
    await expect(world.holders.list(await s.as('outsider'), s.poolA)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('updates only the fields sent and can link a holder to a member who left', async () => {
    const created = await create('owner', { name: 'Ana', aliases: ['ana x'] });
    const renamed = await world.holders.update(await s.as('admin'), s.poolA, created.id, {
      name: 'Ana Maria',
    });
    expect(renamed).toMatchObject({ name: 'Ana Maria', aliases: ['ANA X'], userId: null });

    await expect(
      world.holders.update(await s.as('admin'), s.poolA, created.id, { userId: s.ids.outsider }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      world.holders.update(await s.as('member'), s.poolA, created.id, { name: 'X' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('answers 404 for a holder of another pool and leaves it alone', async () => {
    const other = await create('outsider', { name: 'Bruno' }, s.poolB);
    await expect(
      world.holders.update(await s.as('owner'), s.poolA, other.id, { name: 'Hijacked' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      world.holders.remove(await s.as('owner'), s.poolA, other.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(world.holders.remove(await s.as('owner'), s.poolA, 'nope')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await list('outsider', s.poolB)).toContainEqual(other);
  });

  it('removes a person added by hand and audits it', async () => {
    const created = await create('owner', { name: 'Ana' });
    await world.holders.remove(await s.as('owner'), s.poolA, created.id);
    expect(await manual('owner')).toEqual([]);
    const entries = await rows<{ action: string }>(
      world.identity,
      sql`select action from audit_log where target = ${created.id}`,
    );
    expect(entries.map((entry) => entry.action).sort()).toEqual([
      'holder.created',
      'holder.deleted',
    ]);
  });
});
