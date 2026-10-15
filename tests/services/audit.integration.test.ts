import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { testEnv } from '@nestvault/config/node';
import { auditLogRepo, createIdentityDatabase, newId, usersRepo } from '@nestvault/db';
import {
  ACCOUNT_AUDIT_ACTIONS,
  createAccountService,
  createAuth,
  createMemoryEmailSender,
  createPoolsService,
  ForbiddenError,
  listAuditLog,
  permissionsOfRole,
  POOL_AUDIT_ACTIONS,
  recordAccountAudit,
  recordAudit,
  ValidationError,
  type AccountService,
  type Auth,
} from '@nestvault/services';

import { openTestDatabase } from '../db/harness';
import { APP_URL, cookieOf, PASSWORD, postAuth, registerUser, rows } from '../support/auth-harness';
import { asMember, asSystem, createPool, createUser } from '../support/factories';

const NEW_PASSWORD = 'another-long-unique-passphrase';

const testDb = openTestDatabase();
const identity = createIdentityDatabase(testEnv().TEST_DATABASE_URL_IDENTITY, 4);

const ownerOf = (poolId: string, userId = newId()) =>
  asMember({ poolId }, 'owner', {
    user: createUser({ id: userId }),
    permissions: [...permissionsOfRole('owner')],
  });

const countOf = async (action: string) =>
  Number(
    (
      await rows<{ n: string }>(
        identity,
        sql`select count(*)::text as n from audit_log where action = ${action}`,
      )
    )[0]?.n,
  );

const entriesOf = (action: string) =>
  rows<{ pool_id: string | null; user_id: string | null }>(
    identity,
    sql`select pool_id, user_id from audit_log where action = ${action}`,
  );

beforeEach(async () => {
  await testDb.truncateAll();
});
afterAll(async () => {
  await identity.close();
  await testDb.close();
});

describe('insert-only table', () => {
  it('lets the runtime user insert and read', async () => {
    await recordAccountAudit(identity, 'auth.signin', { userId: newId() });
    expect(await countOf('auth.signin')).toBe(1);
  });

  it.each([
    ['UPDATE', sql`update audit_log set action = 'x'`],
    ['DELETE', sql`delete from audit_log`],
    ['TRUNCATE', sql`truncate audit_log`],
  ])('refuses %s as identity_rw', async (_name, statement) => {
    await recordAccountAudit(identity, 'auth.signin', { userId: newId() });
    const failure = await identity.db.execute(statement).catch((error: unknown) => error);
    expect(String((failure as { cause?: unknown }).cause)).toMatch(/permission denied/);
    expect(await countOf('auth.signin')).toBe(1);
  });
});

describe('one entry per action', () => {
  it.each(POOL_AUDIT_ACTIONS)('writes exactly one entry for %s', async (action) => {
    const pool = createPool();
    const actor = newId();
    await recordAudit(identity, ownerOf(pool.poolId, actor), action, { target: newId() });
    expect(await entriesOf(action)).toEqual([{ pool_id: pool.poolId, user_id: actor }]);
  });

  it.each(ACCOUNT_AUDIT_ACTIONS)('writes exactly one entry for %s', async (action) => {
    const userId = newId();
    await recordAccountAudit(identity, action, { userId });
    expect(await entriesOf(action)).toEqual([{ pool_id: null, user_id: userId }]);
  });

  it('records a system actor without a user', async () => {
    const pool = createPool();
    await recordAudit(identity, asSystem(pool), 'invite.cancelled');
    expect(await entriesOf('invite.cancelled')).toEqual([{ pool_id: pool.poolId, user_id: null }]);
  });

  it('never fails the caller for an account action when the write fails', async () => {
    const broken = {
      ...identity,
      db: { insert: () => ({ values: () => Promise.reject(new Error('down')) }) },
    };
    await expect(
      recordAccountAudit(broken as unknown as typeof identity, 'auth.signin', { userId: null }),
    ).resolves.toBeUndefined();
  });
});

describe('what is stored', () => {
  it('drops meta keys that are not allow-listed and values that are free text', async () => {
    const pool = createPool();
    await recordAudit(identity, ownerOf(pool.poolId), 'member.role_changed', {
      target: newId(),
      meta: {
        role: 'admin',
        previousRole: 'member',
        amount: '1234.56',
        iban: 'PT50000201231234567890154',
        note: 'private text',
        email: 'ana@example.test',
        token: 'abc',
        reason: 'ana@example.test',
        count: Number.NaN,
        nested: { role: 'owner' },
      },
    });
    const [row] = await rows<{ meta: unknown }>(identity, sql`select meta from audit_log`);
    expect(row?.meta).toEqual({ role: 'admin', previousRole: 'member' });
  });

  it('keeps a target that is an id and drops one that is not; hides the untrusted address', async () => {
    const pool = createPool();
    const target = newId();
    await recordAudit(identity, ownerOf(pool.poolId), 'member.removed', { target, ip: '10.1.2.3' });
    await recordAudit(identity, ownerOf(pool.poolId), 'member.removed', {
      target: 'ana@example.test',
      ip: 'untrusted-proxy',
    });
    const found = await rows<{ target: string | null; ip: string | null }>(
      identity,
      sql`select target, ip from audit_log order by at`,
    );
    expect(found).toEqual([
      { target, ip: '10.1.2.3' },
      { target: null, ip: null },
    ]);
  });

  it('treats an injection payload as data', async () => {
    const pool = createPool();
    const payload = "'; DROP TABLE audit_log; --";
    await recordAudit(identity, ownerOf(pool.poolId), 'invite.created', {
      target: payload,
      meta: { reason: payload },
    });
    await recordAccountAudit(identity, 'auth.signin_failed', { userId: payload, ip: payload });
    expect(await countOf('invite.created')).toBe(1);
    expect(await countOf('auth.signin_failed')).toBe(1);
    await expect(listAuditLog(identity, ownerOf(pool.poolId), { action: payload })).rejects.toThrow(
      ValidationError,
    );
  });
});

describe('listAuditLog', () => {
  it('shows the owner the pool entries, newest first, with a masked address', async () => {
    const pool = createPool();
    const owner = ownerOf(pool.poolId);
    await recordAudit(identity, owner, 'pool.created', { ip: '85.240.12.34' });
    await recordAudit(identity, owner, 'invite.created');
    const page = await listAuditLog(identity, owner, {});
    expect(page.entries.map((entry) => entry.action)).toEqual(['invite.created', 'pool.created']);
    expect(page.entries[1]?.ipMasked).toBe('85.240.x.x');
    expect(JSON.stringify(page)).not.toContain('85.240.12.34');
    expect(page.nextBefore).toBeNull();
  });

  it.each(['admin', 'member', 'viewer'] as const)('answers 403 to a %s', async (role) => {
    const pool = createPool();
    const ctx = asMember(pool, role, { permissions: [...permissionsOfRole(role)] });
    await expect(listAuditLog(identity, ctx, {})).rejects.toThrow(ForbiddenError);
  });

  it("never shows another pool's entries", async () => {
    const mine = createPool();
    const other = createPool();
    await recordAudit(identity, ownerOf(other.poolId), 'pool.created');
    await recordAudit(identity, ownerOf(mine.poolId), 'invite.created');
    const page = await listAuditLog(identity, ownerOf(mine.poolId), {});
    expect(page.entries.map((entry) => entry.action)).toEqual(['invite.created']);
  });

  it('filters by action and date, and pages with a cursor', async () => {
    const pool = createPool();
    const owner = ownerOf(pool.poolId);
    for (const action of ['pool.created', 'invite.created', 'invite.created'] as const) {
      await recordAudit(identity, owner, action);
    }
    const onlyInvites = await listAuditLog(identity, owner, { action: 'invite.created' });
    expect(onlyInvites.entries).toHaveLength(2);

    const first = await listAuditLog(identity, owner, { limit: 2 });
    expect(first.entries).toHaveLength(2);
    expect(first.nextBefore).not.toBeNull();
    const second = await listAuditLog(identity, owner, { limit: 2, before: first.nextBefore });
    expect(second.entries).toHaveLength(1);
    expect(second.nextBefore).toBeNull();

    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect((await listAuditLog(identity, owner, { from: future })).entries).toEqual([]);
    expect((await listAuditLog(identity, owner, { to: future })).entries).toHaveLength(3);
  });

  it('pages through entries that share a timestamp without repeating or skipping any', async () => {
    const pool = createPool();
    const owner = ownerOf(pool.poolId);
    for (let i = 0; i < 5; i += 1) {
      await identity.db.execute(
        sql`insert into audit_log (id, pool_id, action, at) values (${newId()}, ${pool.poolId}, 'invite.created', '2026-01-01 12:00:00.123456+00')`,
      );
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof listAuditLog>> = await listAuditLog(identity, owner, {
        limit: 2,
        ...(cursor ? { before: cursor } : {}),
      });
      seen.push(...page.entries.map((entry) => entry.id));
      cursor = page.nextBefore;
    } while (cursor);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it.each([
    { limit: 0 },
    { limit: 1000 },
    { action: 'nope' },
    { from: 'yesterday' },
    { before: '2026-01-01T00:00:00Z' },
    { x: 1 },
  ])('rejects the query %j', async (query) => {
    const pool = createPool();
    await expect(listAuditLog(identity, ownerOf(pool.poolId), query)).rejects.toThrow(
      ValidationError,
    );
  });

  it('has a repository that only reads and inserts', () => {
    expect(Object.keys(auditLogRepo).sort()).toEqual([
      'countForPool',
      'countForUser',
      'insert',
      'listForPool',
    ]);
  });
});

describe('wired into sign-in, passwords and sessions', () => {
  let auth: Auth;
  let account: AccountService;

  beforeEach(() => {
    auth = createAuth({
      identity,
      appUrl: APP_URL,
      secret: 'x'.repeat(40),
      allowSignup: true,
      email: createMemoryEmailSender(),
      trustedProxyHops: 1,
      checkBreached: () => Promise.resolve(false),
    });
    account = createAccountService({
      auth,
      identity,
      pools: createPoolsService({ auth, identity, trustedProxyHops: 1 }),
      trustedProxyHops: 1,
    });
  });

  const ip = { 'x-forwarded-for': '85.240.12.34' };
  const signIn = (password: string, headers?: Record<string, string>) =>
    postAuth(auth, '/sign-in/email', { email: 'ana@example.test', password }, headers);
  const signedUpUser = async () => {
    await registerUser(auth, identity, 'ana@example.test');
    return (await usersRepo.findIdByEmail(identity.db, 'ana@example.test')) ?? '';
  };

  it('records one sign-in, and one failed sign-in without a user', async () => {
    const userId = await signedUpUser();

    expect((await signIn('wrong-wrong-wrong', ip)).status).toBe(401);
    expect((await signIn(PASSWORD, ip)).status).toBe(200);

    expect(await auditLogRepo.countForUser(identity.db, userId, 'auth.signin')).toBe(1);
    expect(await countOf('auth.signin')).toBe(1);
    const failed = await rows<{ user_id: string | null; ip: string | null; meta: unknown }>(
      identity,
      sql`select user_id, ip, meta from audit_log where action = 'auth.signin_failed'`,
    );
    expect(failed).toEqual([{ user_id: null, ip: '85.240.12.34', meta: {} }]);
    expect(JSON.stringify(await rows(identity, sql`select * from audit_log`))).not.toContain(
      'ana@example.test',
    );
  });

  it('records one password change and one session revocation', async () => {
    const userId = await signedUpUser();
    const cookie = cookieOf(await signIn(PASSWORD));
    await signIn(PASSWORD);

    const changed = await postAuth(
      auth,
      '/change-password',
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, revokeOtherSessions: false },
      { cookie },
    );
    expect(changed.status).toBe(200);
    expect(await auditLogRepo.countForUser(identity.db, userId, 'auth.password_changed')).toBe(1);

    const headers = new Headers({ cookie });
    const { sessions } = await account.listSessions(headers);
    const other = sessions.find((entry) => !entry.current);
    await account.revokeSession(headers, other?.id ?? '');
    expect(await auditLogRepo.countForUser(identity.db, userId, 'session.revoked')).toBe(1);

    // The password changed above, so the second device signs in with the new one.
    await signIn(NEW_PASSWORD);
    await account.revokeOtherSessions(headers);
    expect(await auditLogRepo.countForUser(identity.db, userId, 'session.revoked')).toBe(2);
    // Nothing left to revoke: no entry for an action that did nothing.
    await account.revokeOtherSessions(headers);
    expect(await auditLogRepo.countForUser(identity.db, userId, 'session.revoked')).toBe(2);
  });
});
