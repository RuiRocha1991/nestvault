import { describe, expect, it } from 'vitest';

import { newId, withPool } from '@nestvault/db';
import type { PoolContext } from '@nestvault/db';
import { createPoolContext } from '@nestvault/db/pool-context-factory';

import { probeRepo } from './probe';

const valid = () => ({
  poolId: newId(),
  actor: { kind: 'user', userId: newId() } as const,
  role: 'member' as const,
  permissions: ['probe.read'],
});

describe('createPoolContext', () => {
  it('builds a frozen context with a copy of the permissions', () => {
    const permissions = new Set(['probe.read']);
    const ctx = createPoolContext({ ...valid(), permissions });
    permissions.add('probe.write');
    expect(ctx.permissions.has('probe.read')).toBe(true);
    expect(ctx.permissions.has('probe.write')).toBe(false);
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(() => {
      (ctx as { poolId: string }).poolId = newId();
    }).toThrow(TypeError);
  });

  it('keeps the permissions read-only for every holder of the context', () => {
    const ctx = createPoolContext({ ...valid(), permissions: ['probe.read'] });
    const permissions = ctx.permissions as Set<string>;
    expect(() => permissions.add('accounts.write')).toThrow(TypeError);
    expect(() => permissions.delete('probe.read')).toThrow(TypeError);
    expect(() => {
      permissions.clear();
    }).toThrow(TypeError);
    expect([...ctx.permissions]).toEqual(['probe.read']);
  });

  it('stores both ids lower-case so they match the text Postgres returns', () => {
    const poolId = newId();
    const userId = newId();
    const ctx = createPoolContext({
      ...valid(),
      poolId: poolId.toUpperCase(),
      actor: { kind: 'user', userId: userId.toUpperCase() },
    });
    expect(ctx.poolId).toBe(poolId);
    expect(ctx.actor).toEqual({ kind: 'user', userId });
  });

  it('accepts the system actor with the system role', () => {
    const ctx = createPoolContext({
      poolId: newId(),
      actor: { kind: 'system' },
      role: 'system',
      permissions: [],
    });
    expect(ctx.role).toBe('system');
  });

  it.each([
    '',
    'not-a-uuid',
    "' OR 1=1 --",
    '00000000-0000-0000-0000-00000000000g',
    'a'.repeat(36),
    '00000000-0000-0000-0000-000000000000', // nil
    '0190f3a2-7b1c-4d3e-9a4b-1c2d3e4f5a6b', // v4: this project only generates v7
  ])('rejects the pool id %j', (poolId) => {
    expect(() => createPoolContext({ ...valid(), poolId })).toThrow(TypeError);
  });

  it('rejects an invalid user id, an unknown role and a mismatched system role', () => {
    expect(() =>
      createPoolContext({ ...valid(), actor: { kind: 'user', userId: 'nope' } }),
    ).toThrow(TypeError);
    expect(() =>
      createPoolContext({ ...valid(), role: 'superuser' as unknown as 'owner' }),
    ).toThrow(TypeError);
    expect(() => createPoolContext({ ...valid(), role: 'system' })).toThrow(TypeError);
    expect(() =>
      createPoolContext({
        ...valid(),
        actor: { kind: 'user', userId: '0190f3a2-7b1c-4d3e-9a4b-1c2d3e4f5a6b' },
      }),
    ).toThrow(TypeError);
  });
});

// These are compile-time checks: `pnpm typecheck` fails if any @ts-expect-error stops being an
// error, i.e. if a repository or withPool could be called without a real PoolContext.
describe('the PoolContext contract at compile time', () => {
  it('rejects calls without a PoolContext (checked by tsc)', () => {
    function neverCalled() {
      // @ts-expect-error a repository cannot be called without a context
      void probeRepo.list(undefined as never);
      // @ts-expect-error a plain object does not satisfy the opaque PoolContext
      void probeRepo.list(undefined as never, { poolId: newId(), role: 'owner' });
      // @ts-expect-error withPool needs a PoolContext, not a pool id
      void withPool(newId(), () => Promise.resolve());
      // @ts-expect-error an object literal cannot forge the brand
      const forged: PoolContext = {
        poolId: newId(),
        actor: { kind: 'system' },
        role: 'system',
        permissions: new Set(),
      };
      return forged;
    }
    expect(typeof neverCalled).toBe('function');
  });
});
