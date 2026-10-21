import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { testEnv } from '@nestvault/config/node';
import { auditLogRepo, createIdentityDatabase, newId } from '@nestvault/db';
import {
  createAuth,
  createMemoryEmailSender,
  createPool,
  createPoolsService,
  MAX_OWNED_POOLS,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  type Auth,
  type PoolsService,
} from '@nestvault/services';

import { openTestDatabase } from '../db/harness';
import { APP_URL, cookieOf, PASSWORD, postAuth, registerUser } from '../support/auth-harness';

const testDb = openTestDatabase();
const identity = createIdentityDatabase(testEnv().TEST_DATABASE_URL_IDENTITY, 4);

let auth: Auth;
let pools: PoolsService;

const rows = async <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
  (await identity.db.execute(query)).rows as T[];

async function signedIn(email: string): Promise<Headers> {
  await registerUser(auth, identity, email);
  const res = await postAuth(auth, '/sign-in/email', { email, password: PASSWORD });
  return new Headers({ cookie: cookieOf(res) });
}

const userIdOf = async (email: string) =>
  (await rows<{ id: string }>(sql`select id from "user" where email = ${email}`))[0]?.id ?? '';

beforeEach(async () => {
  vi.restoreAllMocks();
  await testDb.truncateAll();
  auth = createAuth({
    identity,
    appUrl: APP_URL,
    secret: 'x'.repeat(40),
    allowSignup: true,
    email: createMemoryEmailSender(),
    trustedProxyHops: 1,
    checkBreached: () => Promise.resolve(false),
  });
  pools = createPoolsService({ auth, identity });
});
afterAll(async () => {
  await identity.close();
  await testDb.close();
});

describe('createPool', () => {
  it('makes the creator the only member, as owner, and records one pool.created entry', async () => {
    const headers = await signedIn('ana@example.test');
    const created = await pools.create(headers, { name: '  Família Rocha  ' });

    expect(created).toMatchObject({ name: 'Família Rocha', role: 'owner', memberCount: 1 });
    const userId = await userIdOf('ana@example.test');
    expect(await rows(sql`select user_id, role from pool_members`)).toEqual([
      { user_id: userId, role: 'owner' },
    ]);
    expect(
      await rows(sql`select pool_id, user_id, action from audit_log where action = 'pool.created'`),
    ).toEqual([{ pool_id: created.id, user_id: userId, action: 'pool.created' }]);
  });

  it('copies no categories: the pool has no data of its own yet', async () => {
    await pools.create(await signedIn('ana@example.test'), { name: 'Casa' });
    expect(await rows(sql`select count(*)::int as n from pools`)).toEqual([{ n: 1 }]);
  });

  it('keeps nothing when the audit entry cannot be written (one transaction)', async () => {
    const userId = newId();
    await identity.db.execute(
      sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${userId}, 'Ana', 'rb@example.test', true, now(), now())`,
    );
    vi.spyOn(auditLogRepo, 'insert').mockRejectedValueOnce(new Error('audit down'));

    await expect(createPool(identity, { userId, name: 'Família' })).rejects.toThrow('audit down');

    expect(await rows(sql`select id from pools`)).toEqual([]);
    expect(await rows(sql`select user_id from pool_members`)).toEqual([]);
    expect(await rows(sql`select id from audit_log`)).toEqual([]);
  });

  it('keeps the pool and the entry together on success', async () => {
    const headers = await signedIn('ana@example.test');
    await pools.create(headers, { name: 'Família' });
    expect(await rows(sql`select count(*)::int as n from pools`)).toEqual([{ n: 1 }]);
    expect(
      await rows(sql`select count(*)::int as n from audit_log where action = 'pool.created'`),
    ).toEqual([{ n: 1 }]);
  });

  it.each([
    {},
    { name: '' },
    { name: '   ' },
    { name: 'x'.repeat(61) },
    { name: 'a\nb' },
    { name: 'a\u0000b' },
    { name: 42 },
    { name: 'Casa', role: 'owner' },
    { name: 'Casa', id: newId() },
    null,
  ])('refuses the input %j', async (input) => {
    const headers = await signedIn('ana@example.test');
    await expect(pools.create(headers, input)).rejects.toBeInstanceOf(ValidationError);
    expect(await rows(sql`select id from pools`)).toEqual([]);
  });

  it('accepts exactly 60 characters and stores a script tag and an SQL payload as plain text', async () => {
    const headers = await signedIn('ana@example.test');
    const long = 'x'.repeat(60);
    expect((await pools.create(headers, { name: long })).name).toBe(long);
    const payload = `'); DROP TABLE pools; -- <script>alert(1)</script>`.slice(0, 60);
    expect((await pools.create(headers, { name: payload })).name).toBe(payload);
    const names = (await rows<{ name: string }>(sql`select name from pools`)).map((r) => r.name);
    expect(names).toContain(payload);
    expect(await rows(sql`select count(*)::int as n from pools`)).toEqual([{ n: 2 }]);
  });

  it('answers 401 without a session and creates nothing', async () => {
    await expect(pools.create(new Headers(), { name: 'Casa' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(await rows(sql`select id from pools`)).toEqual([]);
  });

  it('stops at the ownership cap', async () => {
    const headers = await signedIn('ana@example.test');
    for (let i = 0; i < MAX_OWNED_POOLS; i += 1) await pools.create(headers, { name: `Casa ${i}` });
    await expect(pools.create(headers, { name: 'Uma a mais' })).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe('listMine', () => {
  it('lists only the pools of the caller with their role and member count', async () => {
    const ana = await signedIn('ana@example.test');
    const rui = await signedIn('rui@example.test');
    const mine = await pools.create(ana, { name: 'Casa da Ana' });
    await pools.create(rui, { name: 'Casa do Rui' });
    // Rui is also a viewer of Ana's pool.
    await identity.db.execute(
      sql`insert into pool_members (pool_id, user_id, role) values (${mine.id}, ${await userIdOf('rui@example.test')}, 'viewer')`,
    );

    const list = await pools.listMine(ana);
    expect(list.pools.map((p) => [p.name, p.role, p.memberCount])).toEqual([
      ['Casa da Ana', 'owner', 2],
    ]);
    const ruiList = await pools.listMine(rui);
    expect(ruiList.pools.map((p) => [p.name, p.role]).sort()).toEqual([
      ['Casa da Ana', 'viewer'],
      ['Casa do Rui', 'owner'],
    ]);
  });

  it('orders by recent activity and reports the pool the session opened last', async () => {
    const ana = await signedIn('ana@example.test');
    const first = await pools.create(ana, { name: 'Primeira' });
    const second = await pools.create(ana, { name: 'Segunda' });
    await pools.open(ana, first.id);

    const list = await pools.listMine(ana);
    expect(list.pools.map((p) => p.name)).toEqual(['Segunda', 'Primeira']);
    expect(list.activePoolId).toBe(first.id);
    expect(second.id).not.toBe(first.id);
  });

  it('has no active pool before one was opened, and answers 401 without a session', async () => {
    const ana = await signedIn('ana@example.test');
    expect(await pools.listMine(ana)).toEqual({ pools: [], activePoolId: null });
    await expect(pools.listMine(new Headers())).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('does not report an active pool the user no longer belongs to', async () => {
    const ana = await signedIn('ana@example.test');
    const created = await pools.create(ana, { name: 'Casa' });
    await pools.open(ana, created.id);
    await identity.db.execute(sql`delete from pool_members`);
    expect((await pools.listMine(ana)).activePoolId).toBeNull();
  });
});

describe('open', () => {
  it('opens a pool of the caller', async () => {
    const ana = await signedIn('ana@example.test');
    const created = await pools.create(ana, { name: 'Casa' });
    expect(await pools.open(ana, created.id)).toMatchObject({ id: created.id, role: 'owner' });
  });

  it("answers the same 404 for another user's pool, an unknown id and a hostile one", async () => {
    const ana = await signedIn('ana@example.test');
    const rui = await signedIn('rui@example.test');
    const theirs = await pools.create(rui, { name: 'Casa do Rui' });
    for (const id of [theirs.id, newId(), "' OR 1=1 --", '../etc/passwd', '']) {
      await expect(pools.open(ana, id)).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it('answers 401 without a session', async () => {
    await expect(pools.open(new Headers(), newId())).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('rename', () => {
  const addMember = async (poolId: string, email: string, role: string) => {
    await identity.db.execute(
      sql`insert into pool_members (pool_id, user_id, role) values (${poolId}, ${await userIdOf(email)}, ${role})`,
    );
  };

  it('lets the owner rename, keeps the id and date, and audits the pool id but never the name', async () => {
    const ana = await signedIn('ana@example.test');
    const created = await pools.create(ana, { name: 'Casa' });
    const before = await pools.open(ana, created.id);
    const renamed = await pools.rename(ana, created.id, { name: '  Família Rocha ' });

    expect(renamed).toMatchObject({ id: created.id, name: 'Família Rocha', role: 'owner' });
    expect(renamed.createdAt).toBe(before.createdAt);
    expect((await pools.open(ana, created.id)).name).toBe('Família Rocha');
    const entries = await rows<{ target: string; meta: unknown }>(
      sql`select target, meta from audit_log where action = 'pool.renamed'`,
    );
    expect(entries).toEqual([{ target: created.id, meta: {} }]);
    expect(JSON.stringify(await rows(sql`select * from audit_log`))).not.toContain('Rocha');
  });

  it.each(['admin', 'member', 'viewer'])(
    'answers 403 to a %s and changes nothing',
    async (role) => {
      const ana = await signedIn('ana@example.test');
      const other = await signedIn('rui@example.test');
      const created = await pools.create(ana, { name: 'Casa' });
      await addMember(created.id, 'rui@example.test', role);
      await expect(pools.rename(other, created.id, { name: 'Roubada' })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      expect((await pools.open(ana, created.id)).name).toBe('Casa');
      expect(await rows(sql`select id from audit_log where action = 'pool.renamed'`)).toEqual([]);
    },
  );

  it('answers 404 to a non-member and never touches the other pool', async () => {
    const ana = await signedIn('ana@example.test');
    const rui = await signedIn('rui@example.test');
    const anas = await pools.create(ana, { name: 'Da Ana' });
    const ruis = await pools.create(rui, { name: 'Do Rui' });
    await expect(pools.rename(rui, anas.id, { name: 'Roubada' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(pools.rename(rui, newId(), { name: 'Nada' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await pools.open(ana, anas.id)).name).toBe('Da Ana');
    expect((await pools.open(rui, ruis.id)).name).toBe('Do Rui');
  });

  it.each([
    {},
    { name: '' },
    { name: '   ' },
    { name: 'x'.repeat(61) },
    { name: 'a\nb' },
    { name: 42 },
    { name: 'Casa', id: newId() },
    { name: 'Casa', createdAt: '2020-01-01T00:00:00.000Z' },
    { name: 'Casa', role: 'owner' },
    null,
  ])('refuses the input %j with 400 and changes nothing', async (input) => {
    const ana = await signedIn('ana@example.test');
    const created = await pools.create(ana, { name: 'Casa' });
    await expect(pools.rename(ana, created.id, input)).rejects.toBeInstanceOf(ValidationError);
    expect((await pools.open(ana, created.id)).name).toBe('Casa');
  });

  it('stores an SQL injection payload as plain text', async () => {
    const ana = await signedIn('ana@example.test');
    const created = await pools.create(ana, { name: 'Casa' });
    const payload = `' OR 1=1; DROP TABLE pools; --`;
    await pools.rename(ana, created.id, { name: payload });
    expect((await pools.open(ana, created.id)).name).toBe(payload);
    expect(await rows(sql`select count(*)::int as n from pools`)).toEqual([{ n: 1 }]);
  });

  it('answers 401 without a session', async () => {
    await expect(pools.rename(new Headers(), newId(), { name: 'Casa' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('keeps the old name when the audit entry cannot be written (one transaction)', async () => {
    const ana = await signedIn('ana@example.test');
    const created = await pools.create(ana, { name: 'Casa' });
    vi.spyOn(auditLogRepo, 'insert').mockRejectedValueOnce(new Error('audit down'));
    await expect(pools.rename(ana, created.id, { name: 'Nova' })).rejects.toThrow('audit down');
    expect((await pools.open(ana, created.id)).name).toBe('Casa');
  });
});
