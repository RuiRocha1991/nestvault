import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { testEnv } from '@nestvault/config/node';
import {
  createIdentityDatabase,
  poolMembersRepo,
  sessionsRepo,
  usersRepo,
  type Role,
} from '@nestvault/db';
import {
  ConflictError,
  createAuth,
  createInvitesService,
  createInviteVerifier,
  createMembersService,
  createMemoryEmailSender,
  createPoolsService,
  createRateLimiter,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
  type Auth,
  type InvitesService,
  type MembersService,
  type PoolsService,
} from '@nestvault/services';

import { openTestDatabase } from '../db/harness';
import {
  APP_URL,
  cookieOf,
  createTestClock,
  PASSWORD,
  postAuth,
  registerUser,
  rows,
  SECRET,
} from '../support/auth-harness';

const testDb = openTestDatabase();
const identity = createIdentityDatabase(testEnv().TEST_DATABASE_URL_IDENTITY, 6);

const clock = createTestClock();
let auth: Auth;
let pools: PoolsService;
let members: MembersService;
let invites: InvitesService;

function build() {
  const mail = createMemoryEmailSender();
  const limiter = createRateLimiter({ identity, secret: SECRET, now: clock.now });
  auth = createAuth({
    identity,
    appUrl: APP_URL,
    secret: SECRET,
    email: mail,
    limiter,
    trustedProxyHops: 1,
    allowSignup: true,
    invites: createInviteVerifier(identity, clock.now),
    checkBreached: () => Promise.resolve(false),
  });
  pools = createPoolsService({ auth, identity });
  members = createMembersService({ auth, identity, limiter, trustedProxyHops: 1 });
  invites = createInvitesService({
    auth,
    identity,
    limiter,
    email: mail,
    appUrl: APP_URL,
    trustedProxyHops: 1,
    now: clock.now,
  });
}

/** Registers the user and signs in; call `signIn` again for a second session of the same user. */
async function signIn(email: string): Promise<Headers> {
  const res = await postAuth(auth, '/sign-in/email', { email, password: PASSWORD });
  return new Headers({ cookie: cookieOf(res) });
}

async function register(email: string, name: string): Promise<Headers> {
  await registerUser(auth, identity, email, { name });
  return signIn(email);
}

const userIdOf = async (email: string) => (await usersRepo.findIdByEmail(identity.db, email)) ?? '';

interface Setup {
  poolId: string;
  owner: Headers;
  admin: Headers;
  member: Headers;
  viewer: Headers;
  ids: Record<'owner' | 'admin' | 'member' | 'viewer', string>;
}

/** A pool owned by Rui with one Ana (admin), Beto (member) and Carla (viewer). */
async function setUpPool(): Promise<Setup> {
  const owner = await register('owner@example.test', 'Rui');
  const { id: poolId } = await pools.create(owner, { name: 'Família Rocha' });
  const heads = {} as Record<'admin' | 'member' | 'viewer', Headers>;
  const names = { admin: 'Ana', member: 'Beto', viewer: 'Carla' } as const;
  for (const role of ['admin', 'member', 'viewer'] as const) {
    const email = `${role}@example.test`;
    heads[role] = await register(email, names[role]);
    await poolMembersRepo.insert(identity.db, { poolId, userId: await userIdOf(email), role });
  }
  const ids = {
    owner: await userIdOf('owner@example.test'),
    admin: await userIdOf('admin@example.test'),
    member: await userIdOf('member@example.test'),
    viewer: await userIdOf('viewer@example.test'),
  };
  return { poolId, owner, ...heads, ids };
}

const roleOf = (poolId: string, userId: string): Promise<Role | null> =>
  poolMembersRepo.findRole(identity.db, poolId, userId);

const auditActions = async () =>
  (
    await rows<{ action: string }>(
      identity,
      sql`select action from audit_log where action like 'member.%' or action = 'pool.ownership_transferred' order by at, id`,
    )
  ).map((row) => row.action);

const sessionCount = async (userId: string) =>
  (
    await rows<{ n: string }>(
      identity,
      sql`select count(*)::text as n from session where user_id = ${userId}`,
    )
  )[0]?.n;

const ownerCount = async (poolId: string) =>
  Number(
    (
      await rows<{ n: string }>(
        identity,
        sql`select count(*)::text as n from pool_members where pool_id = ${poolId} and role = 'owner'`,
      )
    )[0]?.n,
  );

beforeEach(async () => {
  await testDb.truncateAll();
  build();
});
afterAll(async () => {
  await identity.close();
  await testDb.close();
});

describe('list', () => {
  it('shows every member to every member, owners first, and the emails only to owners and admins', async () => {
    const s = await setUpPool();
    const asOwner = await members.list(s.owner, s.poolId);
    expect(asOwner.members.map((m) => [m.name, m.role])).toEqual([
      ['Rui', 'owner'],
      ['Ana', 'admin'],
      ['Beto', 'member'],
      ['Carla', 'viewer'],
    ]);
    expect(asOwner.members.find((m) => m.isYou)?.name).toBe('Rui');
    expect(asOwner.members.every((m) => m.email !== null)).toBe(true);
    expect(Object.keys(asOwner.members[0] ?? {}).sort()).toEqual([
      'editable',
      'email',
      'id',
      'isYou',
      'joinedAt',
      'lastActivityAt',
      'name',
      'owner',
      'role',
    ]);

    expect((await members.list(s.admin, s.poolId)).members.every((m) => m.email !== null)).toBe(
      true,
    );
    for (const caller of [s.member, s.viewer]) {
      const seen = await members.list(caller, s.poolId);
      expect(seen.members).toHaveLength(4);
      expect(seen.members.every((m) => m.email === null)).toBe(true);
    }
  });

  it('tells the screen who the caller may edit and who holds the pool', async () => {
    const s = await setUpPool();
    const flags = async (caller: Headers) =>
      Object.fromEntries(
        (await members.list(caller, s.poolId)).members.map((m) => [
          m.name,
          [m.owner, m.editable] as const,
        ]),
      );

    // The owner edits everybody but themselves; the admin everybody but the owner and themselves.
    expect(await flags(s.owner)).toEqual({
      Rui: [true, false],
      Ana: [false, true],
      Beto: [false, true],
      Carla: [false, true],
    });
    expect(await flags(s.admin)).toEqual({
      Rui: [true, false],
      Ana: [false, false],
      Beto: [false, true],
      Carla: [false, true],
    });
    for (const caller of [s.member, s.viewer]) {
      expect(Object.values(await flags(caller)).every(([, editable]) => !editable)).toBe(true);
    }
  });

  it('reports the last activity of the member in this pool', async () => {
    const s = await setUpPool();
    const list = await members.list(s.owner, s.poolId);
    expect(list.members.find((m) => m.name === 'Rui')?.lastActivityAt).not.toBeNull();
    // Beto never opened the pool through a guard: nothing to report.
    expect(list.members.find((m) => m.name === 'Beto')?.lastActivityAt).toBeNull();
  });

  it('never lists another pool’s people, and answers 404/401 to strangers', async () => {
    const s = await setUpPool();
    const other = await register('other@example.test', 'Outra');
    const { id: otherPoolId } = await pools.create(other, { name: 'Outra' });

    expect((await members.list(other, otherPoolId)).members.map((m) => m.name)).toEqual(['Outra']);
    await expect(members.list(other, s.poolId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(members.list(s.owner, 'not-a-uuid')).rejects.toBeInstanceOf(NotFoundError);
    await expect(members.list(new Headers(), s.poolId)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('changeRole', () => {
  it('lets an owner change a role, ends the member’s sessions in the pool and audits it once', async () => {
    const s = await setUpPool();
    await members.list(s.member, s.poolId); // the member's session is now working in this pool

    expect(await members.changeRole(s.owner, s.poolId, s.ids.member, { role: 'admin' })).toEqual({
      id: s.ids.member,
      role: 'admin',
    });
    expect(await roleOf(s.poolId, s.ids.member)).toBe('admin');
    expect(await auditActions()).toEqual(['member.role_changed']);
    const [entry] = await rows<{ target: string; meta: Record<string, string> }>(
      identity,
      sql`select target, meta from audit_log where action = 'member.role_changed'`,
    );
    expect(entry?.target).toBe(s.ids.member);
    expect(entry?.meta).toEqual({
      targetUserId: s.ids.member,
      previousRole: 'member',
      role: 'admin',
    });

    await expect(members.list(s.member, s.poolId)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(await sessionCount(s.ids.member)).toBe('0');
  });

  it('keeps the sessions that were working in another pool', async () => {
    const s = await setUpPool();
    const { id: otherPoolId } = await pools.create(s.member, { name: 'Casa da Beto' });
    const elsewhere = await signIn('member@example.test');
    await members.list(elsewhere, otherPoolId);
    await members.list(s.member, s.poolId);
    expect(await sessionCount(s.ids.member)).toBe('2');

    await members.changeRole(s.owner, s.poolId, s.ids.member, { role: 'viewer' });

    expect(await sessionCount(s.ids.member)).toBe('1');
    expect((await members.list(elsewhere, otherPoolId)).members).toHaveLength(1);
  });

  it('uses the new permissions on the very next request (nothing is cached)', async () => {
    const s = await setUpPool();
    const second = await signIn('admin@example.test'); // a session that never opened the pool
    await expect(
      invites.create(s.admin, s.poolId, { email: 'x@example.test', role: 'viewer' }),
    ).resolves.toBeDefined();

    await members.changeRole(s.owner, s.poolId, s.ids.admin, { role: 'viewer' });

    await expect(invites.listPending(second, s.poolId)).rejects.toBeInstanceOf(ForbiddenError);
    const promoted = await signIn('viewer@example.test');
    await members.changeRole(s.owner, s.poolId, s.ids.viewer, { role: 'admin' });
    await expect(invites.listPending(promoted, s.poolId)).resolves.toBeDefined();
  });

  it('keeps admins away from owners and from handing out owner (403, nothing changes)', async () => {
    const s = await setUpPool();
    await expect(
      members.changeRole(s.admin, s.poolId, s.ids.owner, { role: 'member' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      members.changeRole(s.admin, s.poolId, s.ids.member, { role: 'owner' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await roleOf(s.poolId, s.ids.owner)).toBe('owner');
    expect(await roleOf(s.poolId, s.ids.member)).toBe('member');
    expect(await auditActions()).toEqual([]);

    await expect(
      members.changeRole(s.admin, s.poolId, s.ids.viewer, { role: 'member' }),
    ).resolves.toMatchObject({ role: 'member' });
  });

  it('never lets somebody change their own role (403), not even an owner', async () => {
    const s = await setUpPool();
    await expect(
      members.changeRole(s.owner, s.poolId, s.ids.owner, { role: 'admin' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      members.changeRole(s.admin, s.poolId, s.ids.admin, { role: 'viewer' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await roleOf(s.poolId, s.ids.owner)).toBe('owner');
    expect(await roleOf(s.poolId, s.ids.admin)).toBe('admin');
  });

  it('is 403 for a member or a viewer and writes nothing', async () => {
    const s = await setUpPool();
    for (const caller of [s.member, s.viewer]) {
      await expect(
        members.changeRole(caller, s.poolId, s.ids.admin, { role: 'viewer' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(await roleOf(s.poolId, s.ids.admin)).toBe('admin');
    expect(await auditActions()).toEqual([]);
  });

  it('does nothing and records nothing when the role is already the same', async () => {
    const s = await setUpPool();
    await members.list(s.member, s.poolId);
    await members.changeRole(s.owner, s.poolId, s.ids.member, { role: 'member' });
    expect(await auditActions()).toEqual([]);
    expect(await sessionCount(s.ids.member)).toBe('1');
  });

  it('lets an owner demote another owner but never the last one', async () => {
    const s = await setUpPool();
    await members.changeRole(s.owner, s.poolId, s.ids.admin, { role: 'owner', password: PASSWORD });
    expect(await ownerCount(s.poolId)).toBe(2);
    await members.changeRole(s.owner, s.poolId, s.ids.admin, { role: 'viewer' });
    expect(await ownerCount(s.poolId)).toBe(1);
  });

  it('leaves one owner when two owners demote each other at the same time', async () => {
    const s = await setUpPool();
    await members.changeRole(s.owner, s.poolId, s.ids.admin, { role: 'owner', password: PASSWORD });
    const second = await signIn('admin@example.test');

    const results = await Promise.allSettled([
      members.changeRole(s.owner, s.poolId, s.ids.admin, { role: 'viewer' }),
      members.changeRole(second, s.poolId, s.ids.owner, { role: 'viewer' }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await ownerCount(s.poolId)).toBe(1);
  });

  describe('making an owner needs the caller’s password', () => {
    const promote = (s: Setup, body: unknown) =>
      members.changeRole(s.owner, s.poolId, s.ids.member, body);

    it('promotes with the right password: role changed, sessions ended, one audit entry', async () => {
      const s = await setUpPool();
      await members.list(s.member, s.poolId);
      await expect(promote(s, { role: 'owner', password: PASSWORD })).resolves.toEqual({
        id: s.ids.member,
        role: 'owner',
      });
      expect(await roleOf(s.poolId, s.ids.member)).toBe('owner');
      expect(await auditActions()).toEqual(['member.role_changed']);
      expect(await sessionCount(s.ids.member)).toBe('0');
    });

    it('refuses a missing password with an issue on `password` and changes nothing', async () => {
      const s = await setUpPool();
      const error = await promote(s, { role: 'owner' }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).issues).toEqual([
        { path: 'password', message: 'incorrect' },
      ]);
      expect(await roleOf(s.poolId, s.ids.member)).toBe('member');
      expect(await auditActions()).toEqual([]);
    });

    it('refuses a wrong password, counts it in the password limit and never stores or echoes it', async () => {
      const s = await setUpPool();
      const wrong = 'wrong-password-for-promotion';
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const error = await promote(s, { role: 'owner', password: wrong }).catch(
          (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(ValidationError);
        expect(JSON.stringify((error as ValidationError).issues)).not.toContain(wrong);
        expect((error as Error).message).not.toContain(wrong);
      }
      await expect(promote(s, { role: 'owner', password: PASSWORD })).rejects.toBeInstanceOf(
        RateLimitError,
      );
      expect(await roleOf(s.poolId, s.ids.member)).toBe('member');
      expect(JSON.stringify(await rows(identity, sql`select * from audit_log`))).not.toContain(
        wrong,
      );
    });

    it('does not ask for it, and does not read it, for the other roles', async () => {
      const s = await setUpPool();
      await expect(promote(s, { role: 'admin' })).resolves.toMatchObject({ role: 'admin' });
      await expect(
        members.changeRole(s.owner, s.poolId, s.ids.viewer, { role: 'member', password: 'x' }),
      ).resolves.toMatchObject({ role: 'member' });
    });

    it('does not count a successful promotion against the limit', async () => {
      const s = await setUpPool();
      for (let round = 0; round < 6; round += 1) {
        await promote(s, { role: 'owner', password: PASSWORD });
        await poolMembersRepo.updateRole(identity.db, s.poolId, s.ids.member, 'member');
      }
      expect(await ownerCount(s.poolId)).toBe(1);
    });

    it('refuses an admin with 403 before asking for a password, and an empty or oversized password (400)', async () => {
      const s = await setUpPool();
      await expect(
        members.changeRole(s.admin, s.poolId, s.ids.member, { role: 'owner' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      for (const password of ['', 'x'.repeat(200), 5]) {
        await expect(promote(s, { role: 'owner', password })).rejects.toBeInstanceOf(
          ValidationError,
        );
      }
      expect(await roleOf(s.poolId, s.ids.member)).toBe('member');
    });
  });

  it('rejects mass assignment and unknown roles (400) and writes nothing', async () => {
    const s = await setUpPool();
    const bodies = [
      { role: 'admin', poolId: s.poolId },
      { role: 'admin', userId: s.ids.owner },
      { role: 'admin', id: s.ids.owner },
      { role: 'superuser' },
      {},
      null,
      'admin',
    ];
    for (const body of bodies) {
      await expect(
        members.changeRole(s.owner, s.poolId, s.ids.member, body),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await roleOf(s.poolId, s.ids.member)).toBe('member');
    expect(await auditActions()).toEqual([]);
  });

  it('answers 404 for a user of another pool, an unknown or malformed id, and a non-member caller', async () => {
    const s = await setUpPool();
    const other = await register('other@example.test', 'Outra');
    await pools.create(other, { name: 'Outra' });
    const outsider = await userIdOf('other@example.test');

    for (const target of [outsider, '0197a1b2-0000-7000-8000-000000000000', 'not-a-uuid']) {
      await expect(
        members.changeRole(s.owner, s.poolId, target, { role: 'viewer' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    }
    await expect(
      members.changeRole(other, s.poolId, s.ids.member, { role: 'viewer' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      members.changeRole(new Headers(), s.poolId, s.ids.member, { role: 'viewer' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(await roleOf(s.poolId, s.ids.member)).toBe('member');
  });
});

describe('remove', () => {
  it('removes the member at once: 404 on the pool, sessions in it end, one member.removed entry', async () => {
    const s = await setUpPool();
    await members.list(s.member, s.poolId);

    await members.remove(s.owner, s.poolId, s.ids.member);

    expect(await roleOf(s.poolId, s.ids.member)).toBeNull();
    expect(await auditActions()).toEqual(['member.removed']);
    const [entry] = await rows<{ target: string; meta: Record<string, string> }>(
      identity,
      sql`select target, meta from audit_log where action = 'member.removed'`,
    );
    expect(entry?.target).toBe(s.ids.member);
    expect(entry?.meta).toEqual({ targetUserId: s.ids.member, previousRole: 'member' });
    expect(await sessionCount(s.ids.member)).toBe('0');

    // A session that was not working in the pool still reaches the next request: it gets the 404.
    const fresh = await signIn('member@example.test');
    await expect(members.list(fresh, s.poolId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('keeps the account and its other pools', async () => {
    const s = await setUpPool();
    const { id: ownPool } = await pools.create(s.member, { name: 'Casa da Beto' });
    await members.remove(s.owner, s.poolId, s.ids.member);
    expect(await userIdOf('member@example.test')).toBe(s.ids.member);
    expect(await roleOf(ownPool, s.ids.member)).toBe('owner');
  });

  it('keeps admins away from owners (403) and lets them remove members and viewers', async () => {
    const s = await setUpPool();
    await expect(members.remove(s.admin, s.poolId, s.ids.owner)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await roleOf(s.poolId, s.ids.owner)).toBe('owner');
    await members.remove(s.admin, s.poolId, s.ids.viewer);
    expect(await roleOf(s.poolId, s.ids.viewer)).toBeNull();
  });

  it('refuses removing yourself (403: leaving is its own action) and a member or viewer caller', async () => {
    const s = await setUpPool();
    await expect(members.remove(s.owner, s.poolId, s.ids.owner)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(members.remove(s.member, s.poolId, s.ids.viewer)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(members.remove(s.viewer, s.poolId, s.ids.member)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await auditActions()).toEqual([]);
  });

  it('lets an owner remove another owner', async () => {
    const s = await setUpPool();
    await members.changeRole(s.owner, s.poolId, s.ids.admin, { role: 'owner', password: PASSWORD });
    await members.remove(s.owner, s.poolId, s.ids.admin);
    expect(await ownerCount(s.poolId)).toBe(1);
  });

  it('answers 404 for another pool’s user and malformed ids, and leaves them alone', async () => {
    const s = await setUpPool();
    const other = await register('other@example.test', 'Outra');
    const { id: otherPoolId } = await pools.create(other, { name: 'Outra' });
    const outsider = await userIdOf('other@example.test');

    await expect(members.remove(s.owner, s.poolId, outsider)).rejects.toBeInstanceOf(NotFoundError);
    await expect(members.remove(s.owner, s.poolId, 'x')).rejects.toBeInstanceOf(NotFoundError);
    await expect(members.remove(other, s.poolId, s.ids.member)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await roleOf(otherPoolId, outsider)).toBe('owner');
    expect(await roleOf(s.poolId, s.ids.member)).toBe('member');
  });
});

describe('leave', () => {
  it('lets a member leave: 404 afterwards, the session stays, one member.left entry', async () => {
    const s = await setUpPool();
    await members.list(s.member, s.poolId);

    await members.leave(s.member, s.poolId);

    expect(await roleOf(s.poolId, s.ids.member)).toBeNull();
    expect(await auditActions()).toEqual(['member.left']);
    expect(await sessionCount(s.ids.member)).toBe('1');
    const [left] = await rows<{ active_pool_id: string | null }>(
      identity,
      sql`select active_pool_id from session where user_id = ${s.ids.member}`,
    );
    expect(left?.active_pool_id).toBeNull();
    await expect(members.list(s.member, s.poolId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(members.leave(s.member, s.poolId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lets a viewer and an admin leave too', async () => {
    const s = await setUpPool();
    await members.leave(s.viewer, s.poolId);
    await members.leave(s.admin, s.poolId);
    expect((await members.list(s.owner, s.poolId)).members.map((m) => m.name)).toEqual([
      'Rui',
      'Beto',
    ]);
  });

  it('refuses the only owner (409) and changes nothing', async () => {
    const s = await setUpPool();
    await expect(members.leave(s.owner, s.poolId)).rejects.toBeInstanceOf(ConflictError);
    expect(await roleOf(s.poolId, s.ids.owner)).toBe('owner');
    expect(await auditActions()).toEqual([]);
  });

  it('lets an owner leave when another owner remains', async () => {
    const s = await setUpPool();
    await members.changeRole(s.owner, s.poolId, s.ids.admin, { role: 'owner', password: PASSWORD });
    await members.leave(s.owner, s.poolId);
    expect(await ownerCount(s.poolId)).toBe(1);
  });

  it('lets exactly one of two owners leave at the same time', async () => {
    const s = await setUpPool();
    await members.changeRole(s.owner, s.poolId, s.ids.admin, { role: 'owner', password: PASSWORD });
    const second = await signIn('admin@example.test');

    const results = await Promise.allSettled([
      members.leave(s.owner, s.poolId),
      members.leave(second, s.poolId),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await ownerCount(s.poolId)).toBe(1);
  });

  it('answers 404 to a non-member, 404 to a malformed pool id and 401 without a session', async () => {
    const s = await setUpPool();
    const other = await register('other@example.test', 'Outra');
    await expect(members.leave(other, s.poolId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(members.leave(s.owner, "' OR 1=1 --")).rejects.toBeInstanceOf(NotFoundError);
    await expect(members.leave(new Headers(), s.poolId)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('transferOwnership', () => {
  it('makes the target an owner and the caller an admin, audits once and ends the target’s sessions in the pool', async () => {
    const s = await setUpPool();
    await members.list(s.admin, s.poolId);

    const result = await members.transferOwnership(s.owner, s.poolId, {
      userId: s.ids.admin,
      password: PASSWORD,
    });

    expect(result).toEqual({ poolId: s.poolId, role: 'admin' });
    expect(await roleOf(s.poolId, s.ids.admin)).toBe('owner');
    expect(await roleOf(s.poolId, s.ids.owner)).toBe('admin');
    expect(await auditActions()).toEqual(['pool.ownership_transferred']);
    expect(await sessionCount(s.ids.admin)).toBe('0');
    // The caller keeps working: their session is untouched and now carries admin permissions.
    await expect(members.list(s.owner, s.poolId)).resolves.toBeDefined();
    await expect(
      members.transferOwnership(s.owner, s.poolId, { userId: s.ids.member, password: PASSWORD }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lets the caller stay an owner when asked', async () => {
    const s = await setUpPool();
    const result = await members.transferOwnership(s.owner, s.poolId, {
      userId: s.ids.member,
      password: PASSWORD,
      keepOwnership: true,
    });
    expect(result.role).toBe('owner');
    expect(await ownerCount(s.poolId)).toBe(2);
    const [entry] = await rows<{ meta: Record<string, string> }>(
      identity,
      sql`select meta from audit_log where action = 'pool.ownership_transferred'`,
    );
    expect(entry?.meta).toMatchObject({ role: 'owner', reason: 'kept_owner' });
  });

  it('refuses a wrong password with an issue on `password`, changes nothing and never logs it', async () => {
    const s = await setUpPool();
    const error = await members
      .transferOwnership(s.owner, s.poolId, { userId: s.ids.admin, password: 'wrong-password-123' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).issues).toEqual([{ path: 'password', message: 'incorrect' }]);
    expect(await roleOf(s.poolId, s.ids.owner)).toBe('owner');
    expect(await roleOf(s.poolId, s.ids.admin)).toBe('admin');
    expect(await auditActions()).toEqual([]);
    const log = JSON.stringify(await rows(identity, sql`select * from audit_log`));
    expect(log).not.toContain('wrong-password-123');
  });

  it('shares the password-attempt limit: the sixth wrong password is a 429, even with the right one after', async () => {
    const s = await setUpPool();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        members.transferOwnership(s.owner, s.poolId, {
          userId: s.ids.admin,
          password: 'nope-nope',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(
      members.transferOwnership(s.owner, s.poolId, { userId: s.ids.admin, password: PASSWORD }),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(await roleOf(s.poolId, s.ids.owner)).toBe('owner');
  });

  it('does not count a successful transfer against the limit', async () => {
    const s = await setUpPool();
    for (let round = 0; round < 6; round += 1) {
      await members.transferOwnership(s.owner, s.poolId, {
        userId: s.ids.member,
        password: PASSWORD,
        keepOwnership: true,
      });
      // Back to a plain member, so the next round has a non-owner target again.
      await poolMembersRepo.updateRole(identity.db, s.poolId, s.ids.member, 'member');
    }
    expect(await ownerCount(s.poolId)).toBe(1);
  });

  it('is owners only (403) and checks the pool first (404, 401)', async () => {
    const s = await setUpPool();
    for (const caller of [s.admin, s.member, s.viewer]) {
      await expect(
        members.transferOwnership(caller, s.poolId, { userId: s.ids.member, password: PASSWORD }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    const other = await register('other@example.test', 'Outra');
    await expect(
      members.transferOwnership(other, s.poolId, { userId: s.ids.member, password: PASSWORD }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      members.transferOwnership(new Headers(), s.poolId, {
        userId: s.ids.member,
        password: PASSWORD,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(await roleOf(s.poolId, s.ids.owner)).toBe('owner');
  });

  it('needs another member of this pool as the target', async () => {
    const s = await setUpPool();
    const other = await register('other@example.test', 'Outra');
    await pools.create(other, { name: 'Outra' });
    const outsider = await userIdOf('other@example.test');

    await expect(
      members.transferOwnership(s.owner, s.poolId, { userId: outsider, password: PASSWORD }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      members.transferOwnership(s.owner, s.poolId, { userId: s.ids.owner, password: PASSWORD }),
    ).rejects.toBeInstanceOf(ValidationError);
    await members.changeRole(s.owner, s.poolId, s.ids.admin, { role: 'owner', password: PASSWORD });
    await expect(
      members.transferOwnership(s.owner, s.poolId, { userId: s.ids.admin, password: PASSWORD }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects extra fields, a missing password and a malformed target (400)', async () => {
    const s = await setUpPool();
    const bodies = [
      { userId: s.ids.admin, password: PASSWORD, poolId: s.poolId },
      { userId: s.ids.admin, password: PASSWORD, role: 'owner' },
      { userId: s.ids.admin },
      { password: PASSWORD },
      { userId: 'not-a-uuid', password: PASSWORD },
      { userId: s.ids.admin, password: '' },
      { userId: s.ids.admin, password: PASSWORD, keepOwnership: 'yes' },
      null,
    ];
    for (const body of bodies) {
      await expect(members.transferOwnership(s.owner, s.poolId, body)).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    expect(await roleOf(s.poolId, s.ids.owner)).toBe('owner');
  });
});

describe('poolMembersRepo and sessionsRepo (pool isolation and injection)', () => {
  const PAYLOADS = ["' OR 1=1 --", "'; DROP TABLE pool_members; --", "x' OR '1'='1"];

  it('never lists, locks, changes or removes another pool’s members', async () => {
    const s = await setUpPool();
    const other = await register('other@example.test', 'Outra');
    const { id: otherPoolId } = await pools.create(other, { name: 'Outra' });
    const outsider = await userIdOf('other@example.test');

    expect(
      (await poolMembersRepo.listMembers(identity.db, s.poolId)).map((m) => m.userId),
    ).not.toContain(outsider);
    expect(await poolMembersRepo.updateRole(identity.db, s.poolId, outsider, 'viewer')).toBe(false);
    expect(await poolMembersRepo.remove(identity.db, s.poolId, outsider)).toBe(false);
    expect(await roleOf(otherPoolId, outsider)).toBe('owner');
    const locked = await identity.db.transaction((tx) => poolMembersRepo.lockMembers(tx, s.poolId));
    expect(locked.map((m) => m.userId)).not.toContain(outsider);
  });

  it.each(PAYLOADS)(
    'treats %s as data: the ids are bound parameters and nothing runs',
    async (payload) => {
      const s = await setUpPool();
      const before = await rows(identity, sql`select * from pool_members`);

      await expect(poolMembersRepo.listMembers(identity.db, payload)).rejects.toThrow();
      await expect(
        poolMembersRepo.updateRole(identity.db, s.poolId, payload, 'viewer'),
      ).rejects.toThrow();
      await expect(poolMembersRepo.remove(identity.db, payload, s.ids.member)).rejects.toThrow();
      await expect(usersRepo.passwordHashOf(identity.db, payload)).rejects.toThrow();
      await expect(sessionsRepo.endInPool(identity.db, payload, s.poolId)).rejects.toThrow();

      expect(await rows(identity, sql`select * from pool_members`)).toEqual(before);
      // The service stops a payload before it reaches a query.
      await expect(members.remove(s.owner, s.poolId, payload)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(
        members.changeRole(s.owner, s.poolId, payload, { role: 'viewer' }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(members.list(s.owner, payload)).rejects.toBeInstanceOf(NotFoundError);
      expect(await rows(identity, sql`select * from pool_members`)).toEqual(before);
    },
  );
});
