import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { testEnv } from '@nestvault/config/node';
import {
  createIdentityDatabase,
  invitesRepo,
  newId,
  poolMembersRepo,
  usersRepo,
} from '@nestvault/db';
import {
  ConflictError,
  createAuth,
  createInvitesService,
  createInviteVerifier,
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
  type MemoryEmailSender,
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
  tokenIn,
  verifyEmail,
} from '../support/auth-harness';

const testDb = openTestDatabase();
const identity = createIdentityDatabase(testEnv().TEST_DATABASE_URL_IDENTITY, 4);

const DAY = 24 * 60 * 60;
const clock = createTestClock();
let mail: MemoryEmailSender;
/** Open sign-up: how the tests create their users. */
let auth: Auth;
/** Closed sign-up, as the default instance runs: people join with an invite. */
let closedAuth: Auth;
let pools: PoolsService;
let invites: InvitesService;

function build() {
  mail = createMemoryEmailSender();
  const limiter = createRateLimiter({ identity, secret: SECRET, now: clock.now });
  const shared = {
    identity,
    appUrl: APP_URL,
    secret: SECRET,
    email: mail,
    limiter,
    trustedProxyHops: 1,
    invites: createInviteVerifier(identity, clock.now),
    checkBreached: () => Promise.resolve(false),
  };
  auth = createAuth({ ...shared, allowSignup: true });
  closedAuth = createAuth({ ...shared, allowSignup: false });
  pools = createPoolsService({ auth, identity });
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

async function signedIn(email: string, name = 'Ana'): Promise<Headers> {
  await registerUser(auth, identity, email, { name });
  const res = await postAuth(auth, '/sign-in/email', { email, password: PASSWORD });
  return new Headers({ cookie: cookieOf(res) });
}

const userIdOf = async (email: string) => (await usersRepo.findIdByEmail(identity.db, email)) ?? '';

/** A pool owned by `owner@example.test`, plus one extra member per role. */
async function setUpPool() {
  const owner = await signedIn('owner@example.test', 'Rui');
  const { id: poolId } = await pools.create(owner, { name: 'Família Rocha' });
  const members = {} as Record<'admin' | 'member' | 'viewer', Headers>;
  for (const role of ['admin', 'member', 'viewer'] as const) {
    const email = `${role}@example.test`;
    members[role] = await signedIn(email);
    await poolMembersRepo.insert(identity.db, { poolId, userId: await userIdOf(email), role });
  }
  return { owner, poolId, ...members };
}

/** Sign-up verification emails share the sender; only the invite emails count here. */
const inviteMails = () => mail.sent.filter((message) => message.subject.startsWith('Convite para'));
const lastToken = () => tokenIn(inviteMails().at(-1)?.text ?? '', 'convite');
const QUERIES = {
  invites: sql`select * from invites`,
  audit_log: sql`select * from audit_log`,
  pool_members: sql`select * from pool_members`,
};
const table = async (name: keyof typeof QUERIES) => rows(identity, QUERIES[name]);

beforeEach(async () => {
  await testDb.truncateAll();
  build();
});
afterAll(async () => {
  await identity.close();
  await testDb.close();
});

describe('create', () => {
  it('stores a pending invite, emails the link and records one invite.created entry', async () => {
    const { owner, poolId } = await setUpPool();
    const created = await invites.create(owner, poolId, {
      email: 'Joao@Example.TEST',
      role: 'member',
    });

    expect(created).toMatchObject({ email: 'joao@example.test', role: 'member' });
    expect(new Date(created.expiresAt).getTime() - clock.now().getTime()).toBe(7 * DAY * 1000);
    expect(Object.keys(created).sort()).toEqual(['createdAt', 'email', 'expiresAt', 'id', 'role']);

    expect(inviteMails()).toHaveLength(1);
    expect(inviteMails()[0]).toMatchObject({ to: 'joao@example.test' });
    expect(inviteMails()[0]?.subject).toContain('Família Rocha');
    expect(inviteMails()[0]?.text).toContain('Rui');
    expect(lastToken()).toHaveLength(43);

    const entries = await rows(
      identity,
      sql`select action, target, user_id, meta from audit_log where action = 'invite.created'`,
    );
    expect(entries).toEqual([
      {
        action: 'invite.created',
        target: created.id,
        user_id: await userIdOf('owner@example.test'),
        meta: { inviteId: created.id, role: 'member' },
      },
    ]);
  });

  it('never stores the token: only its SHA-256 hash, and it is absent from the audit log', async () => {
    const { owner, poolId } = await setUpPool();
    await invites.create(owner, poolId, { email: 'joao@example.test', role: 'viewer' });
    const token = lastToken();

    expect(JSON.stringify(await table('invites'))).not.toContain(token);
    expect(JSON.stringify(await table('audit_log'))).not.toContain(token);
    expect(JSON.stringify(await table('audit_log'))).not.toContain('joao@example.test');
    const [stored] = await table('invites');
    expect(stored?.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('lets an admin invite up to admin but not an owner (403, nothing written)', async () => {
    const { admin, poolId } = await setUpPool();
    await invites.create(admin, poolId, { email: 'a@example.test', role: 'admin' });
    await expect(
      invites.create(admin, poolId, { email: 'b@example.test', role: 'owner' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await table('invites')).toHaveLength(1);
  });

  it('lets an owner invite another owner', async () => {
    const { owner, poolId } = await setUpPool();
    await expect(
      invites.create(owner, poolId, { email: 'co@example.test', role: 'owner' }),
    ).resolves.toMatchObject({ role: 'owner' });
  });

  it.each(['member', 'viewer'] as const)(
    'refuses a %s: no members.invite permission (403)',
    async (role) => {
      const pool = await setUpPool();
      await expect(
        invites.create(pool[role], pool.poolId, { email: 'x@example.test', role: 'viewer' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(await table('invites')).toEqual([]);
      expect(inviteMails()).toEqual([]);
    },
  );

  it('answers 401 without a session', async () => {
    const { poolId } = await setUpPool();
    await expect(
      invites.create(new Headers(), poolId, { email: 'x@example.test', role: 'viewer' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('answers the same 404 for a non-member, an unknown pool and a malformed id', async () => {
    const { poolId } = await setUpPool();
    const stranger = await signedIn('stranger@example.test');
    const body = { email: 'x@example.test', role: 'viewer' };
    for (const target of [poolId, newId(), 'not-a-uuid', "' OR 1=1 --"]) {
      await expect(invites.create(stranger, target, body)).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(await table('invites')).toEqual([]);
  });

  it.each([
    ['an extra poolId', { email: 'x@example.test', role: 'viewer', poolId: newId() }],
    ['an extra invitedBy', { email: 'x@example.test', role: 'viewer', invitedBy: newId() }],
    ['an extra id', { email: 'x@example.test', role: 'viewer', id: newId() }],
    ['an unknown role', { email: 'x@example.test', role: 'superuser' }],
    ['no role', { email: 'x@example.test' }],
    ['an invalid email', { email: 'not-an-email', role: 'viewer' }],
    ['an injection payload as email', { email: "' OR 1=1 --", role: 'viewer' }],
    ['a non-object body', 'x@example.test'],
  ])('rejects %s with a validation error and writes nothing', async (_name, body) => {
    const { owner, poolId } = await setUpPool();
    await expect(invites.create(owner, poolId, body)).rejects.toBeInstanceOf(ValidationError);
    expect(await table('invites')).toEqual([]);
    expect(inviteMails()).toEqual([]);
  });

  it('replaces the pending invite of the same address: the old link stops working', async () => {
    const { owner, poolId } = await setUpPool();
    await invites.create(owner, poolId, { email: 'joao@example.test', role: 'viewer' });
    const first = lastToken();
    await invites.create(owner, poolId, { email: 'JOAO@example.test', role: 'admin' });
    const second = lastToken();

    expect(first).not.toBe(second);
    expect(await table('invites')).toHaveLength(1);
    expect(await invites.preview(new Headers(), first)).toBeNull();
    expect(await invites.preview(new Headers(), second)).toMatchObject({ role: 'admin' });
  });

  it('refuses an address that already belongs to the pool (409)', async () => {
    const { owner, poolId } = await setUpPool();
    await expect(
      invites.create(owner, poolId, { email: 'MEMBER@example.test', role: 'viewer' }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await table('invites')).toEqual([]);
  });

  it('allows 20 invites a day per pool and the 21st is a 429', async () => {
    const { owner, poolId } = await setUpPool();
    for (let n = 0; n < 20; n += 1) {
      await invites.create(owner, poolId, { email: `p${String(n)}@example.test`, role: 'viewer' });
    }
    await expect(
      invites.create(owner, poolId, { email: 'p20@example.test', role: 'viewer' }),
    ).rejects.toBeInstanceOf(RateLimitError);
    clock.advance(DAY + 1);
    await expect(
      invites.create(owner, poolId, { email: 'p20@example.test', role: 'viewer' }),
    ).resolves.toBeDefined();
  });

  it('keeps the invite when the email cannot be sent (the inviter can resend)', async () => {
    const { owner, poolId } = await setUpPool();
    const failing = createInvitesService({
      auth,
      identity,
      limiter: createRateLimiter({ identity, secret: SECRET, now: clock.now }),
      email: { send: () => Promise.reject(new Error('smtp down')) },
      appUrl: APP_URL,
      now: clock.now,
    });
    await expect(
      failing.create(owner, poolId, { email: 'x@example.test', role: 'viewer' }),
    ).resolves.toBeDefined();
    expect(await table('invites')).toHaveLength(1);
  });
});

describe('listPending', () => {
  it('lists the pool’s pending invites only, newest first, with no token', async () => {
    const { owner, admin, poolId } = await setUpPool();
    const other = await signedIn('other@example.test');
    const { id: otherPoolId } = await pools.create(other, { name: 'Outra' });
    await invites.create(owner, poolId, { email: 'one@example.test', role: 'viewer' });
    await invites.create(admin, poolId, { email: 'two@example.test', role: 'member' });
    await invites.create(other, otherPoolId, { email: 'theirs@example.test', role: 'viewer' });

    const { invites: listed } = await invites.listPending(owner, poolId);
    expect(listed.map((invite) => invite.email)).toEqual(['two@example.test', 'one@example.test']);
    expect(JSON.stringify(listed)).not.toMatch(/token/i);
  });

  it('is 403 for a member, 404 for a non-member and 401 without a session', async () => {
    const { member, poolId } = await setUpPool();
    const stranger = await signedIn('stranger@example.test');
    await expect(invites.listPending(member, poolId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(invites.listPending(stranger, poolId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(invites.listPending(new Headers(), poolId)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});

describe('cancel', () => {
  it('deletes the invite, kills its link and records invite.cancelled', async () => {
    const { owner, poolId } = await setUpPool();
    const { id } = await invites.create(owner, poolId, { email: 'x@example.test', role: 'viewer' });
    const token = lastToken();

    await invites.cancel(owner, poolId, id);

    expect(await table('invites')).toEqual([]);
    expect(await invites.preview(new Headers(), token)).toBeNull();
    const entries = await rows(
      identity,
      sql`select action, target from audit_log where action = 'invite.cancelled'`,
    );
    expect(entries).toEqual([{ action: 'invite.cancelled', target: id }]);
  });

  it('answers 404 for another pool’s invite and leaves it untouched', async () => {
    const { owner, poolId } = await setUpPool();
    const other = await signedIn('other@example.test');
    const { id: otherPoolId } = await pools.create(other, { name: 'Outra' });
    const { id } = await invites.create(other, otherPoolId, {
      email: 'x@example.test',
      role: 'viewer',
    });

    await expect(invites.cancel(owner, poolId, id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await table('invites')).toHaveLength(1);
  });

  it.each([
    ['an unknown id', () => newId()],
    ['a malformed id', () => 'nope'],
    ['an injection payload', () => "' OR 1=1 --"],
  ])('answers 404 for %s', async (_name, makeId) => {
    const { owner, poolId } = await setUpPool();
    await invites.create(owner, poolId, { email: 'x@example.test', role: 'viewer' });
    await expect(invites.cancel(owner, poolId, makeId())).rejects.toBeInstanceOf(NotFoundError);
    expect(await table('invites')).toHaveLength(1);
  });

  it('is 403 for a member and keeps an admin away from an owner invite', async () => {
    const { owner, admin, member, poolId } = await setUpPool();
    const { id } = await invites.create(owner, poolId, { email: 'co@example.test', role: 'owner' });
    await expect(invites.cancel(member, poolId, id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(invites.cancel(admin, poolId, id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await table('invites')).toHaveLength(1);
  });

  it('cannot cancel an accepted invite (404)', async () => {
    const { owner, poolId } = await setUpPool();
    const { id } = await invites.create(owner, poolId, {
      email: 'joao@example.test',
      role: 'viewer',
    });
    const joao = await signedIn('joao@example.test');
    await invites.accept(joao, lastToken());
    await expect(invites.cancel(owner, poolId, id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('resend', () => {
  it('gives the invite a new link and expiry and the old link stops working', async () => {
    const { owner, poolId } = await setUpPool();
    const { id } = await invites.create(owner, poolId, { email: 'x@example.test', role: 'member' });
    const first = lastToken();
    clock.advance(3 * DAY);

    const resent = await invites.resend(owner, poolId, id);

    expect(inviteMails()).toHaveLength(2);
    expect(lastToken()).not.toBe(first);
    expect(new Date(resent.expiresAt).getTime() - clock.now().getTime()).toBe(7 * DAY * 1000);
    expect(await invites.preview(new Headers(), first)).toBeNull();
    expect(await invites.preview(new Headers(), lastToken())).toMatchObject({
      email: 'x@example.test',
    });
    const entries = await rows(
      identity,
      sql`select meta from audit_log where target = ${id} order by at`,
    );
    expect(entries.at(-1)).toEqual({ meta: { inviteId: id, role: 'member', reason: 'resend' } });
  });

  it('revives an expired invite', async () => {
    const { owner, poolId } = await setUpPool();
    const { id } = await invites.create(owner, poolId, { email: 'x@example.test', role: 'member' });
    clock.advance(8 * DAY);
    expect(await invites.preview(new Headers(), lastToken())).toBeNull();
    await invites.resend(owner, poolId, id);
    expect(await invites.preview(new Headers(), lastToken())).not.toBeNull();
  });

  it('answers 404 for another pool’s invite, 403 for a member and 401 without a session', async () => {
    const { owner, member, poolId } = await setUpPool();
    const other = await signedIn('other@example.test');
    const { id: otherPoolId } = await pools.create(other, { name: 'Outra' });
    const { id: theirs } = await invites.create(other, otherPoolId, {
      email: 'x@example.test',
      role: 'viewer',
    });
    const { id } = await invites.create(owner, poolId, { email: 'y@example.test', role: 'viewer' });

    await expect(invites.resend(owner, poolId, theirs)).rejects.toBeInstanceOf(NotFoundError);
    await expect(invites.resend(member, poolId, id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(invites.resend(new Headers(), poolId, id)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});

describe('preview', () => {
  it('shows the pool, the inviter, the address, the role and the expiry of a valid link', async () => {
    const { owner, poolId } = await setUpPool();
    await invites.create(owner, poolId, { email: 'x@example.test', role: 'member' });
    expect(await invites.preview(new Headers(), lastToken())).toEqual({
      poolName: 'Família Rocha',
      inviterName: 'Rui',
      email: 'x@example.test',
      role: 'member',
      expiresAt: new Date(clock.now().getTime() + 7 * DAY * 1000).toISOString(),
    });
  });

  it('is null for expired, used, unknown, malformed and injection-payload tokens alike', async () => {
    const { owner, poolId } = await setUpPool();
    await invites.create(owner, poolId, { email: 'x@example.test', role: 'member' });
    const token = lastToken();
    const joao = await signedIn('x@example.test');

    for (const bad of ['', 'abc', "' OR 1=1 --", `${token}x`, 'A'.repeat(43)]) {
      expect(await invites.preview(new Headers(), bad)).toBeNull();
    }
    clock.advance(7 * DAY + 1);
    expect(await invites.preview(new Headers(), token)).toBeNull();
    clock.advance(-(7 * DAY + 1));
    await invites.accept(joao, token);
    expect(await invites.preview(new Headers(), token)).toBeNull();
    expect(await table('invites')).toHaveLength(1);
  });

  it('is limited per client IP (61st lookup in a minute answers null)', async () => {
    const { owner, poolId } = await setUpPool();
    await invites.create(owner, poolId, { email: 'x@example.test', role: 'member' });
    const token = lastToken();
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7' });
    for (let n = 0; n < 60; n += 1) await invites.preview(headers, token);
    expect(await invites.preview(headers, token)).toBeNull();
    expect(
      await invites.preview(new Headers({ 'x-forwarded-for': '203.0.113.8' }), token),
    ).not.toBeNull();
  });
});

describe('accept', () => {
  async function invited(role: 'admin' | 'member' | 'viewer' = 'member') {
    const pool = await setUpPool();
    await invites.create(pool.owner, pool.poolId, { email: 'joao@example.test', role });
    return { ...pool, token: lastToken(), joao: await signedIn('joao@example.test') };
  }

  it('adds the member with the invited role, uses the invite up and records invite.accepted', async () => {
    const { poolId, token, joao } = await invited('admin');

    expect(await invites.accept(joao, token)).toEqual({ poolId });

    const userId = await userIdOf('joao@example.test');
    expect(
      await rows(identity, sql`select role from pool_members where user_id = ${userId}`),
    ).toEqual([{ role: 'admin' }]);
    const [invite] = await table('invites');
    expect(invite?.accepted_at).not.toBeNull();
    const entries = await rows(
      identity,
      sql`select action, user_id, pool_id, meta from audit_log where action = 'invite.accepted'`,
    );
    expect(entries).toEqual([
      {
        action: 'invite.accepted',
        user_id: userId,
        pool_id: poolId,
        meta: { inviteId: invite?.id, role: 'admin' },
      },
    ]);
  });

  it('is single use: the second attempt is a 404 and adds nothing', async () => {
    const { token, joao } = await invited();
    await invites.accept(joao, token);
    const before = (await table('pool_members')).length;
    await expect(invites.accept(joao, token)).rejects.toBeInstanceOf(NotFoundError);
    expect(await table('pool_members')).toHaveLength(before);
  });

  it('lets exactly one of two parallel accepts through', async () => {
    const { token, joao } = await invited();
    const results = await Promise.allSettled([
      invites.accept(joao, token),
      invites.accept(joao, token),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      await rows(
        identity,
        sql`select count(*)::int as n from audit_log where action = 'invite.accepted'`,
      ),
    ).toEqual([{ n: 1 }]);
  });

  it('rejects a different signed-in address: same 404, no membership, invite still usable', async () => {
    const { token, poolId } = await invited();
    const ana = await signedIn('ana@example.test');
    await expect(invites.accept(ana, token)).rejects.toBeInstanceOf(NotFoundError);
    expect(
      await rows(
        identity,
        sql`select 1 from pool_members where pool_id = ${poolId} and user_id = ${await userIdOf('ana@example.test')}`,
      ),
    ).toEqual([]);
    expect(await invites.preview(new Headers(), token)).not.toBeNull();
  });

  it('rejects an expired token (7 days) with the same 404', async () => {
    const { token, joao } = await invited();
    clock.advance(7 * DAY + 1);
    await expect(invites.accept(joao, token)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects an address that is not verified', async () => {
    const pool = await setUpPool();
    await invites.create(pool.owner, pool.poolId, { email: 'joao@example.test', role: 'member' });
    const token = lastToken();
    const joao = await signedIn('joao@example.test');
    await identity.db.execute(
      sql`update "user" set email_verified = false where email = 'joao@example.test'`,
    );
    await expect(invites.accept(joao, token)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('answers 401 without a session and 404 for malformed or injection-payload tokens', async () => {
    const { token, joao } = await invited();
    await expect(invites.accept(new Headers(), token)).rejects.toBeInstanceOf(UnauthorizedError);
    for (const bad of ['', 'abc', "' OR 1=1 --", 'A'.repeat(43), `${token}x`]) {
      await expect(invites.accept(joao, bad)).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(await table('invites')).toHaveLength(1);
  });

  it('keeps the existing role of somebody who already belongs to the pool', async () => {
    const { owner, poolId } = await setUpPool();
    await invites.create(owner, poolId, { email: 'late@example.test', role: 'viewer' });
    const token = lastToken();
    const late = await signedIn('late@example.test');
    const userId = await userIdOf('late@example.test');
    await poolMembersRepo.insert(identity.db, { poolId, userId, role: 'member' });

    await expect(invites.accept(late, token)).resolves.toEqual({ poolId });

    expect(
      await rows(identity, sql`select role from pool_members where user_id = ${userId}`),
    ).toEqual([{ role: 'member' }]);
  });
});

describe('sign-up through an invite (ALLOW_SIGNUP=false)', () => {
  const signUp = (email: string, token?: string) =>
    postAuth(
      closedAuth,
      '/sign-up/email',
      { name: 'Joao', email, password: PASSWORD },
      token ? { 'x-invite-token': token } : {},
    );

  it('refuses without a token and with a token for another address', async () => {
    const { owner, poolId } = await setUpPool();
    await invites.create(owner, poolId, { email: 'joao@example.test', role: 'member' });
    const token = lastToken();
    expect((await signUp('joao@example.test')).status).toBe(403);
    expect((await signUp('someone@example.test', token)).status).toBe(403);
    expect(await userIdOf('joao@example.test')).toBe('');
  });

  it('lets the invited address register, then sign in and accept after verifying', async () => {
    const { owner, poolId } = await setUpPool();
    await invites.create(owner, poolId, { email: 'Joao@example.test', role: 'member' });
    const token = lastToken();

    expect((await signUp('JOAO@example.test', token)).status).toBe(200);
    await verifyEmail(identity, 'joao@example.test');
    const res = await postAuth(auth, '/sign-in/email', {
      email: 'joao@example.test',
      password: PASSWORD,
    });
    const joao = new Headers({ cookie: cookieOf(res) });

    expect(await invites.accept(joao, token)).toEqual({ poolId });
  });

  it('refuses expired, used, cancelled and replaced tokens', async () => {
    const { owner, poolId } = await setUpPool();
    const { id } = await invites.create(owner, poolId, {
      email: 'joao@example.test',
      role: 'member',
    });
    const first = lastToken();

    await invites.resend(owner, poolId, id);
    expect((await signUp('joao@example.test', first)).status).toBe(403);

    const second = lastToken();
    clock.advance(7 * DAY + 1);
    expect((await signUp('joao@example.test', second)).status).toBe(403);
    clock.advance(-(7 * DAY + 1));

    await invites.cancel(owner, poolId, id);
    expect((await signUp('joao@example.test', second)).status).toBe(403);
    expect((await signUp('joao@example.test', "' OR 1=1 --")).status).toBe(403);
  });
});

describe('invitesRepo (pool isolation and injection)', () => {
  const PAYLOADS = ["' OR 1=1 --", "'; DROP TABLE invites; --", "Robert'); DROP TABLE invites;--"];

  async function seed() {
    const { owner, poolId } = await setUpPool();
    const other = await signedIn('other@example.test');
    const { id: otherPoolId } = await pools.create(other, { name: 'Outra' });
    const mine = await invites.create(owner, poolId, {
      email: 'mine@example.test',
      role: 'viewer',
    });
    const theirs = await invites.create(other, otherPoolId, {
      email: 'theirs@example.test',
      role: 'viewer',
    });
    return { poolId, otherPoolId, mine, theirs };
  }

  it('never reads, changes or deletes another pool’s invite', async () => {
    const { poolId, mine, theirs } = await seed();
    const next = {
      tokenHash: 'f'.repeat(64),
      expiresAt: new Date(clock.now().getTime() + DAY * 1000),
    };

    expect((await invitesRepo.listPending(identity.db, poolId)).map((row) => row.id)).toEqual([
      mine.id,
    ]);
    expect(await invitesRepo.findPending(identity.db, poolId, theirs.id)).toBeNull();
    expect(await invitesRepo.rotateToken(identity.db, poolId, theirs.id, next)).toBeNull();
    expect(await invitesRepo.deletePending(identity.db, poolId, theirs.id)).toBe(false);
    expect(await table('invites')).toHaveLength(2);
    expect(await poolMembersRepo.existsByEmail(identity.db, poolId, 'other@example.test')).toBe(
      false,
    );
  });

  it.each(PAYLOADS)('treats %s as data in every string parameter', async (payload) => {
    const { poolId, mine } = await seed();
    const userId = await userIdOf('owner@example.test');

    expect(await invitesRepo.findPreviewByTokenHash(identity.db, payload)).toBeNull();
    expect(await poolMembersRepo.existsByEmail(identity.db, poolId, payload)).toBe(false);
    await invitesRepo.upsertPending(identity.db, {
      id: newId(),
      poolId,
      email: payload,
      role: 'viewer',
      tokenHash: payload,
      expiresAt: new Date(clock.now().getTime() + DAY * 1000),
      invitedBy: userId,
    });
    const stored = await invitesRepo.findPreviewByTokenHash(identity.db, payload);
    expect(stored?.email).toBe(payload);
    expect(
      await invitesRepo.rotateToken(identity.db, poolId, mine.id, {
        tokenHash: payload + '2',
        expiresAt: new Date(clock.now().getTime() + DAY * 1000),
      }),
    ).not.toBeNull();
    expect(await table('invites')).toHaveLength(3);
  });
});
