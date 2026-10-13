import { describe, expect, it } from 'vitest';

import { isUuidV7 } from '@nestvault/db';

import { asMember, asSystem, createPool, createUser } from '../support/factories';

describe('test factories', () => {
  it('createUser gives unique ids and addresses', () => {
    const [a, b] = [createUser(), createUser()];
    expect(isUuidV7(a.id)).toBe(true);
    expect(a.id).not.toBe(b.id);
    expect(a.email).not.toBe(b.email);
    expect(createUser({ name: 'Ana' }).name).toBe('Ana');
  });

  it('createPool has its own id and an owner', () => {
    const owner = createUser();
    const pool = createPool(owner);
    expect(isUuidV7(pool.poolId)).toBe(true);
    expect(pool.owner).toBe(owner);
    expect(createPool().poolId).not.toBe(pool.poolId);
  });

  it('asMember builds the context of that user, role and permissions in that pool', () => {
    const pool = createPool();
    const user = createUser();
    const ctx = asMember(pool, 'viewer', { user, permissions: ['accounts.read'] });
    expect(ctx.poolId).toBe(pool.poolId);
    expect(ctx.role).toBe('viewer');
    expect(ctx.actor).toEqual({ kind: 'user', userId: user.id });
    expect([...ctx.permissions]).toEqual(['accounts.read']);
  });

  it('asMember with no options is a new user without permissions', () => {
    const ctx = asMember(createPool(), 'member');
    expect(ctx.actor.kind).toBe('user');
    expect(ctx.permissions.size).toBe(0);
  });

  it('asSystem acts as the system actor', () => {
    const ctx = asSystem(createPool());
    expect(ctx.role).toBe('system');
    expect(ctx.actor).toEqual({ kind: 'system' });
  });
});
