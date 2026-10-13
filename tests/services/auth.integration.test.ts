import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { testEnv } from '@nestvault/config/node';
import { createIdentityDatabase, usersRepo } from '@nestvault/db';
import {
  createAuth,
  getOptionalSession,
  hashSessionToken,
  requireSession,
  seedOwner,
  UnauthorizedError,
  type Auth,
  type InviteVerifier,
} from '@nestvault/services';

import { openTestDatabase } from '../db/harness';

const APP_URL = 'http://localhost:4000';
const PASSWORD = 'a-long-unique-passphrase';

const testDb = openTestDatabase();
const identity = createIdentityDatabase(testEnv().TEST_DATABASE_URL_IDENTITY, 2);

function build(
  options: { allowSignup?: boolean; invites?: InviteVerifier; breached?: boolean } = {},
) {
  return createAuth({
    identity,
    appUrl: APP_URL,
    secret: 'x'.repeat(40),
    allowSignup: options.allowSignup ?? true,
    ...(options.invites ? { invites: options.invites } : {}),
    checkBreached: () => Promise.resolve(options.breached ?? false),
  });
}

function post(auth: Auth, path: string, body: unknown, headers: Record<string, string> = {}) {
  return auth.handler(
    new Request(`${APP_URL}/api/v1/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP_URL, ...headers },
      body: JSON.stringify(body),
    }),
  );
}

const signUp = (auth: Auth, email = 'ana@example.com', password = PASSWORD, h = {}) =>
  post(auth, '/sign-up/email', { name: 'Ana', email, password }, h);

const hashed = (cookie: string) =>
  hashSessionToken(decodeURIComponent(cookie.split('=')[1] ?? '').split('.')[0] ?? '');

async function rows<T extends Record<string, unknown>>(query: ReturnType<typeof sql>) {
  const result = await identity.db.execute<T>(query);
  return result.rows;
}

beforeEach(() => testDb.truncateAll());
afterAll(async () => {
  await identity.close();
  await testDb.close();
});

describe('sign-up', () => {
  it('stores an argon2id hash, never the password', async () => {
    const response = await signUp(build());
    expect(response.status).toBe(200);
    const [account] = await rows<{ password: string }>(sql`select password from account`);
    expect(account?.password.startsWith('$argon2id$')).toBe(true);
    expect(account?.password).not.toContain(PASSWORD);
  });

  it('returns 403 when sign-up is closed and there is no invite', async () => {
    const response = await signUp(build({ allowSignup: false }));
    expect(response.status).toBe(403);
    expect(await rows(sql`select 1 from "user"`)).toHaveLength(0);
  });

  it('opens a closed sign-up only for a valid invite for that email', async () => {
    const invites: InviteVerifier = {
      isValid: ({ token, email }) =>
        Promise.resolve(token === 'good' && email === 'ana@example.com'),
    };
    const auth = build({ allowSignup: false, invites });
    expect(
      (await signUp(auth, 'ana@example.com', PASSWORD, { 'x-invite-token': 'bad' })).status,
    ).toBe(403);
    expect(
      (await signUp(auth, 'bob@example.com', PASSWORD, { 'x-invite-token': 'good' })).status,
    ).toBe(403);
    expect(
      (await signUp(auth, 'ana@example.com', PASSWORD, { 'x-invite-token': 'good' })).status,
    ).toBe(200);
  });

  it('rejects a breached password', async () => {
    const response = await signUp(build({ breached: true }), 'ana@example.com', 'password123456');
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe('PASSWORD_BREACHED');
  });

  it('enforces the 12-128 character length', async () => {
    const auth = build();
    expect((await signUp(auth, 'a@example.com', 'short-pass')).status).toBe(400);
    expect((await signUp(auth, 'b@example.com', 'x'.repeat(129))).status).toBe(400);
  });
});

describe('sessions', () => {
  async function signIn(auth: Auth) {
    await signUp(auth);
    return post(auth, '/sign-in/email', { email: 'ana@example.com', password: PASSWORD });
  }

  it('sets a persistent HttpOnly SameSite=Lax cookie', async () => {
    const cookie = (await signIn(build())).headers.get('set-cookie') ?? '';
    expect(cookie).toContain('nv.session_token=');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).toMatch(/Max-Age=2592000/i);
    expect(cookie).not.toMatch(/Secure/i); // localhost
  });

  it('stores only the SHA-256 of the cookie token and still resolves the session', async () => {
    const auth = build();
    const response = await signIn(auth);
    const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const token = decodeURIComponent(cookie.split('=')[1] ?? '').split('.')[0] ?? '';
    const [stored] = await rows<{ token: string }>(
      sql`select token from session order by created_at desc, id desc`,
    );
    expect(stored?.token).toBe(hashSessionToken(token));
    expect(stored?.token).not.toBe(token);

    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.email).toBe('ana@example.com');
  });

  it('ends the session on sign-out, clears the cookie and the old cookie is no longer a session', async () => {
    const auth = build();
    const cookie = ((await signIn(auth)).headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const response = await post(auth, '/sign-out', {}, { cookie });
    expect(response.headers.get('set-cookie') ?? '').toMatch(/nv\.session_token=;|Max-Age=0/i);
    const headers = new Headers({ cookie });
    expect(await auth.api.getSession({ headers })).toBeNull();
    expect(await getOptionalSession(auth, headers)).toBeNull();
    await expect(requireSession(auth, headers)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(await rows(sql`select 1 from session where token = ${hashed(cookie)}`)).toHaveLength(0);
  });

  it('rejects the stored hash used as a cookie', async () => {
    const auth = build();
    await signIn(auth);
    const [stored] = await rows<{ token: string }>(
      sql`select token from session order by created_at desc, id desc`,
    );
    const forged = `nv.session_token=${stored?.token ?? ''}`;
    expect(await auth.api.getSession({ headers: new Headers({ cookie: forged }) })).toBeNull();
  });

  it('treats an injection payload as data when signing in', async () => {
    const auth = build();
    await signUp(auth);
    const response = await post(auth, '/sign-in/email', {
      email: "' OR 1=1 --",
      password: PASSWORD,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    const wrong = await post(auth, '/sign-in/email', {
      email: 'ana@example.com',
      password: "' OR 1=1 --x-y-z",
    });
    expect(wrong.status).toBe(401);
    expect(await rows(sql`select 1 from "user"`)).toHaveLength(1);
  });
});

describe('seedOwner', () => {
  it('creates the owner once; a second run changes nothing', async () => {
    const input = { name: 'Owner', email: 'Owner@Example.com', password: PASSWORD };
    const first = await seedOwner(identity, input);
    const second = await seedOwner(identity, { ...input, password: 'another-long-passphrase' });
    expect(first.created).toBe(true);
    expect(second).toEqual({ userId: first.userId, created: false });
    const accounts = await rows<{ password: string }>(sql`select password from account`);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.password.startsWith('$argon2id$')).toBe(true);
  });

  it('the seeded owner can sign in', async () => {
    await seedOwner(identity, { name: 'Owner', email: 'owner@example.com', password: PASSWORD });
    const response = await post(build({ allowSignup: false }), '/sign-in/email', {
      email: 'owner@example.com',
      password: PASSWORD,
    });
    expect(response.status).toBe(200);
  });

  it('rejects a short password and treats an injection email as invalid data', async () => {
    await expect(
      seedOwner(identity, { name: 'O', email: 'o@example.com', password: 'short' }),
    ).rejects.toThrow('The seed owner is not valid.');
    await expect(
      seedOwner(identity, { name: 'O', email: "' OR 1=1 --", password: PASSWORD }),
    ).rejects.toThrow('The seed owner is not valid.');
    expect(await rows(sql`select 1 from "user"`)).toHaveLength(0);
  });
});

describe('usersRepo', () => {
  it('looks emails up as data and case-insensitively', async () => {
    await seedOwner(identity, { name: 'O', email: 'o@example.com', password: PASSWORD });
    expect(await usersRepo.findIdByEmail(identity.db, "' OR 1=1 --")).toBeUndefined();
    expect(
      await usersRepo.findIdByEmail(identity.db, 'x\'; DROP TABLE "user"; --'),
    ).toBeUndefined();
    expect(await usersRepo.findIdByEmail(identity.db, 'O@EXAMPLE.COM')).toBeDefined();
    expect(await rows(sql`select 1 from "user"`)).toHaveLength(1);
  });
});
