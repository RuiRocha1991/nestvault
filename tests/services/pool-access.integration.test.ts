import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { testEnv } from '@nestvault/config/node';
import {
  createIdentityDatabase,
  newId,
  poolMembersRepo,
  poolsRepo,
  sessionsRepo,
  usersRepo,
} from '@nestvault/db';
import type { Role } from '@nestvault/db';
import { session } from '@nestvault/db/identity-schema';
import {
  can,
  ForbiddenError,
  NotFoundError,
  permissionsOfRole,
  requirePoolAccess,
} from '@nestvault/services';

import { openTestDatabase } from '../db/harness';

const testDb = openTestDatabase();
const identity = createIdentityDatabase(testEnv().TEST_DATABASE_URL_IDENTITY, 4);

interface Caller {
  userId: string;
  sessionId: string;
}

async function newCaller(): Promise<Caller> {
  const userId = await usersRepo.insertCredentialUser(identity.db, {
    name: 'Ana',
    email: `u-${newId()}@example.test`,
    passwordHash: 'not-a-real-hash',
  });
  const sessionId = newId();
  await identity.db.insert(session).values({
    id: sessionId,
    userId,
    token: `hash-${sessionId}`,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return { userId, sessionId };
}

async function newPool(members: [Caller, Role][]): Promise<string> {
  const id = newId();
  await poolsRepo.insert(identity.db, { id, name: 'Família' });
  for (const [caller, role] of members) {
    await poolMembersRepo.insert(identity.db, { poolId: id, userId: caller.userId, role });
  }
  return id;
}

const activePool = async (sessionId: string) =>
  (await identity.db.select().from(session).where(eq(session.id, sessionId)))[0]?.activePoolId;

async function failureOf(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to fail');
}

beforeEach(async () => {
  await testDb.truncateAll();
});

afterAll(async () => {
  await identity.close();
  await testDb.close();
});

describe('requirePoolAccess', () => {
  it('returns the context of a member with the permissions of the role', async () => {
    const caller = await newCaller();
    const poolId = await newPool([[caller, 'admin']]);
    const ctx = await requirePoolAccess(identity, caller, poolId);
    expect(ctx.poolId).toBe(poolId);
    expect(ctx.role).toBe('admin');
    expect(ctx.actor).toEqual({ kind: 'user', userId: caller.userId });
    expect([...ctx.permissions].sort()).toEqual([...permissionsOfRole('admin')].sort());
  });

  it('answers a non-member, a missing pool and a malformed id with the same 404', async () => {
    const caller = await newCaller();
    const stranger = await newCaller();
    const poolId = await newPool([[stranger, 'owner']]);
    const errors = await Promise.all(
      [
        poolId, // exists, caller is not a member
        newId(), // does not exist
        'not-a-uuid',
        '',
        "' OR 1=1 --",
        "'; DROP TABLE pool_members; --",
        '00000000-0000-4000-8000-000000000000', // a UUID, but not v7
        'x'.repeat(10_000),
      ].map((id) => failureOf(requirePoolAccess(identity, caller, id))),
    );
    for (const error of errors) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error).toMatchObject({ status: 404, code: 'not_found', message: 'Not found.' });
    }
    const [{ count }] = (
      await identity.db.execute<{ count: string }>(sql`select count(*) from pool_members`)
    ).rows as [{ count: string }];
    expect(count).toBe('1'); // the injection payload was only ever data
  });

  it('takes about as long for a pool that does not exist as for one the caller is not in', async () => {
    const caller = await newCaller();
    const stranger = await newCaller();
    const real = await newPool([[stranger, 'owner']]);
    const median = async (poolId: () => string) => {
      const times: number[] = [];
      for (let i = 0; i < 31; i += 1) {
        const started = performance.now();
        await failureOf(requirePoolAccess(identity, caller, poolId()));
        times.push(performance.now() - started);
      }
      return times.sort((a, b) => a - b)[15] ?? 0;
    };
    await median(() => real); // warm the connection pool
    const notMember = await median(() => real);
    const missing = await median(() => newId());
    expect(Math.abs(notMember - missing)).toBeLessThan(15); // ms
  });

  it('keeps pools apart: a member of one pool gets 404 for another', async () => {
    const caller = await newCaller();
    const mine = await newPool([[caller, 'owner']]);
    const other = await newPool([[await newCaller(), 'owner']]);
    await expect(requirePoolAccess(identity, caller, mine)).resolves.toBeDefined();
    await expect(requirePoolAccess(identity, caller, other)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('stops answering once the membership is gone', async () => {
    const caller = await newCaller();
    const poolId = await newPool([[caller, 'member']]);
    await requirePoolAccess(identity, caller, poolId);
    await identity.db.execute(sql`delete from pool_members`);
    await expect(requirePoolAccess(identity, caller, poolId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('gives a viewer the context but 403 on a write permission', async () => {
    const caller = await newCaller();
    const poolId = await newPool([[caller, 'viewer']]);
    const ctx = await requirePoolAccess(identity, caller, poolId);
    expect(() => {
      can(ctx, 'pool.read');
    }).not.toThrow();
    expect(() => {
      can(ctx, 'transactions.write');
    }).toThrow(ForbiddenError);
  });

  it('accepts the pool id in upper case', async () => {
    const caller = await newCaller();
    const poolId = await newPool([[caller, 'owner']]);
    const ctx = await requirePoolAccess(identity, caller, poolId.toUpperCase());
    expect(ctx.poolId).toBe(poolId);
  });
});

describe('active pool of the session', () => {
  it('is remembered after an access and changes with the next pool', async () => {
    const caller = await newCaller();
    const first = await newPool([[caller, 'owner']]);
    const second = await newPool([[caller, 'member']]);
    expect(await activePool(caller.sessionId)).toBeNull();
    await requirePoolAccess(identity, caller, first);
    expect(await activePool(caller.sessionId)).toBe(first);
    await requirePoolAccess(identity, caller, second);
    expect(await activePool(caller.sessionId)).toBe(second);
  });

  it('is not touched by a refused access', async () => {
    const caller = await newCaller();
    const mine = await newPool([[caller, 'owner']]);
    const other = await newPool([[await newCaller(), 'owner']]);
    await requirePoolAccess(identity, caller, mine);
    await failureOf(requirePoolAccess(identity, caller, other));
    expect(await activePool(caller.sessionId)).toBe(mine);
  });

  it('never changes the session of somebody else', async () => {
    const caller = await newCaller();
    const victim = await newCaller();
    const poolId = await newPool([[caller, 'owner']]);
    await requirePoolAccess(
      identity,
      { userId: caller.userId, sessionId: victim.sessionId },
      poolId,
    );
    expect(await activePool(victim.sessionId)).toBeNull();
  });

  it('does not block the request when remembering it fails', async () => {
    const caller = await newCaller();
    const poolId = await newPool([[caller, 'owner']]);
    const spy = vi.spyOn(sessionsRepo, 'setActivePool').mockRejectedValueOnce(new Error('down'));
    await expect(requirePoolAccess(identity, caller, poolId)).resolves.toBeDefined();
    spy.mockRestore();
  });

  it('is cleared when the pool is deleted', async () => {
    const caller = await newCaller();
    const poolId = await newPool([[caller, 'owner']]);
    await requirePoolAccess(identity, caller, poolId);
    await identity.db.execute(sql`delete from pools`);
    expect(await activePool(caller.sessionId)).toBeNull();
  });
});

describe('poolMembersRepo', () => {
  it('rejects a role outside the four known ones', async () => {
    const caller = await newCaller();
    const poolId = await newPool([]);
    await expect(
      identity.db.execute(
        sql`insert into pool_members (pool_id, user_id, role) values (${poolId}, ${caller.userId}, 'root')`,
      ),
    ).rejects.toThrow();
  });
});
