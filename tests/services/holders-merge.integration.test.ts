import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
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
  (await world.holders.list(await s.as(as), poolId)).holders;
const create = async (as: Persona, body: unknown, poolId = s.poolA) =>
  world.holders.create(await s.as(as), poolId, body);
const holderOf = async (persona: Persona) => {
  const found = (await list('owner')).find((holder) => holder.userId === s.ids[persona]);
  if (!found) throw new Error(`no person for ${persona}`);
  return found;
};
const merge = async (as: Persona, id: string, intoId: string, poolId = s.poolA) =>
  world.holders.merge(await s.as(as), poolId, id, { intoId });
const accountFor = async (type: 'checking' | 'brokerage', name: string, holderIds: string[]) =>
  world.accounts.create(await s.as('owner'), s.poolA, {
    type,
    name,
    currency: 'EUR',
    holderIds,
  });
const auditOf = (target: string) =>
  rows<{ action: string; target: string; meta: unknown }>(
    world.identity,
    sql`select action, target, meta from audit_log where action = 'holder.merged' and target = ${target}`,
  );
const aliasList = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix} ${i}`);

describe('holders service: merge', () => {
  it('moves accounts, sub-accounts and aliases to the member, keeps the member name and deletes the source', async () => {
    const target = await holderOf('member');
    await world.holders.update(await s.as('owner'), s.poolA, target.id, { aliases: ['beto x'] });
    const source = await create('owner', { name: 'Ana Manual', aliases: ['ana m', 'beto x'] });
    const solo = await accountFor('checking', 'Solo', [source.id]);
    const joint = await accountFor('checking', 'Conjunta', [source.id, target.id]);
    const brokerage = await accountFor('brokerage', 'Corretora', [source.id]);
    const sub = await world.accounts.createSubAccount(await s.as('owner'), s.poolA, brokerage.id, {
      name: 'Sub',
      holderId: source.id,
    });

    const preview = await world.holders.mergePreview(await s.as('owner'), s.poolA, source.id, {
      intoId: target.id,
    });
    expect(preview).toEqual({
      accounts: 3,
      subAccounts: 1,
      addedAliases: ['ANA M'],
      tooManyAliases: false,
    });
    // The preview changes nothing.
    expect(await list('owner')).toContainEqual(source);

    const merged = await merge('admin', source.id, target.id);
    expect(merged).toMatchObject({ id: target.id, name: target.name, member: true });
    expect([...merged.aliases].sort()).toEqual(['ANA M', 'BETO X']);
    expect((await list('owner')).some((holder) => holder.id === source.id)).toBe(false);

    const headers = await s.as('owner');
    for (const account of [solo, joint, brokerage]) {
      const seen = await world.accounts.get(headers, s.poolA, account.id);
      expect(seen.holderIds).toEqual([target.id]);
    }
    const seen = await world.accounts.get(headers, s.poolA, brokerage.id);
    expect(seen.subAccounts.find((one) => one.id === sub.id)?.holderId).toBe(target.id);
    expect(await auditOf(target.id)).toEqual([
      { action: 'holder.merged', target: target.id, meta: {} },
    ]);
  });

  it('answers 409 and changes nothing when the aliases would pass 10', async () => {
    const target = await holderOf('member');
    await world.holders.update(await s.as('owner'), s.poolA, target.id, {
      aliases: aliasList('AAA', 6),
    });
    const source = await create('owner', { name: 'Ana', aliases: aliasList('BBB', 5) });
    const account = await accountFor('checking', 'Solo', [source.id]);
    const before = await list('owner');

    const preview = await world.holders.mergePreview(await s.as('owner'), s.poolA, source.id, {
      intoId: target.id,
    });
    expect(preview.tooManyAliases).toBe(true);
    await expect(merge('owner', source.id, target.id)).rejects.toBeInstanceOf(ConflictError);
    expect(await list('owner')).toEqual(before);
    const seen = await world.accounts.get(await s.as('owner'), s.poolA, account.id);
    expect(seen.holderIds).toEqual([source.id]);
    expect(await auditOf(target.id)).toEqual([]);
  });

  it('merges to exactly 10 aliases, counting equal ones once', async () => {
    const target = await holderOf('member');
    await world.holders.update(await s.as('owner'), s.poolA, target.id, {
      aliases: aliasList('AAA', 5),
    });
    const source = await create('owner', {
      name: 'Ana',
      aliases: ['AAA 0', ...aliasList('BBB', 5)],
    });
    expect((await merge('owner', source.id, target.id)).aliases).toHaveLength(10);
  });

  it('refuses the person of a member as source, the same person and bad bodies', async () => {
    const target = await holderOf('member');
    const viewer = await holderOf('viewer');
    await expect(merge('owner', viewer.id, target.id)).rejects.toBeInstanceOf(ConflictError);
    const manual = await create('owner', { name: 'Ana' });
    await expect(merge('owner', manual.id, manual.id)).rejects.toBeInstanceOf(ValidationError);
    for (const body of [{}, { intoId: 'nope' }, { intoId: target.id, poolId: s.poolB }]) {
      await expect(
        world.holders.merge(await s.as('owner'), s.poolA, manual.id, body),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await list('owner')).toContainEqual(manual);
  });

  it('answers 404 for a person of another pool on either side and leaves both alone', async () => {
    const target = await holderOf('member');
    const mine = await create('owner', { name: 'Ana', aliases: ['ana m'] });
    const other = await create('outsider', { name: 'Bruno' }, s.poolB);
    await expect(merge('owner', other.id, target.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(merge('owner', mine.id, other.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(merge('owner', 'nope', target.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(merge('outsider', mine.id, target.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await list('owner')).toContainEqual(mine);
    expect(await list('outsider', s.poolB)).toContainEqual(other);
  });

  it('refuses a member and a viewer (403) and no session (401)', async () => {
    const target = await holderOf('member');
    const manual = await create('owner', { name: 'Ana' });
    for (const as of ['member', 'viewer'] as const) {
      await expect(merge(as, manual.id, target.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        world.holders.mergePreview(await s.as(as), s.poolA, manual.id, { intoId: target.id }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(
      world.holders.merge(new Headers(), s.poolA, manual.id, { intoId: target.id }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('merges once when two clicks arrive together; the second answers 404', async () => {
    const target = await holderOf('member');
    const manual = await create('owner', { name: 'Ana', aliases: ['ana m'] });
    await accountFor('checking', 'Solo', [manual.id]);
    const results = await Promise.allSettled([
      merge('owner', manual.id, target.id),
      merge('owner', manual.id, target.id),
    ]);
    expect(results.filter((one) => one.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((one) => one.status === 'rejected');
    expect(failed?.status === 'rejected' && failed.reason).toBeInstanceOf(NotFoundError);
    expect(await auditOf(target.id)).toHaveLength(1);
  });
});
