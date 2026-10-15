import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { testEnv } from '@nestvault/config/node';
import { createIdentityDatabase } from '@nestvault/db';
import {
  createAccountService,
  createAuth,
  createMemoryEmailSender,
  createPoolsService,
  NotFoundError,
  UnauthorizedError,
  verifyEmailWithToken,
  type AccountService,
  type Auth,
  type MemoryEmailSender,
} from '@nestvault/services';

import { openTestDatabase } from '../db/harness';
import { APP_URL, cookieOf, PASSWORD, postAuth, registerUser } from '../support/auth-harness';

const NEW_PASSWORD = 'another-long-unique-passphrase';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const testDb = openTestDatabase();
const identity = createIdentityDatabase(testEnv().TEST_DATABASE_URL_IDENTITY, 4);

let auth: Auth;
let account: AccountService;
let mail: MemoryEmailSender;

const withCookie = (cookie: string) => new Headers({ cookie });

async function register(email: string) {
  await registerUser(auth, identity, email);
  return cookieOf(await signInRaw(email));
}

const signInRaw = (email: string) =>
  postAuth(auth, '/sign-in/email', { email, password: PASSWORD });

async function signIn(email: string, userAgent: string, password = PASSWORD) {
  const res = await postAuth(
    auth,
    '/sign-in/email',
    { email, password },
    { 'user-agent': userAgent, 'x-forwarded-for': '85.240.12.34' },
  );
  expect(res.status).toBe(200);
  return cookieOf(res);
}

beforeEach(async () => {
  await testDb.truncateAll();
  mail = createMemoryEmailSender();
  auth = createAuth({
    identity,
    appUrl: APP_URL,
    secret: 'x'.repeat(40),
    allowSignup: true,
    email: mail,
    trustedProxyHops: 1,
    checkBreached: () => Promise.resolve(false),
  });
  account = createAccountService({ auth, identity, pools: createPoolsService({ auth, identity, trustedProxyHops: 1 }) });
});
afterAll(async () => {
  await identity.close();
  await testDb.close();
});

describe('sessions', () => {
  it('lists the sessions of the user with the current one marked and no secrets', async () => {
    const first = await register('ana@example.com');
    const second = await signIn('ana@example.com', SAFARI_IPHONE);

    const { sessions } = await account.listSessions(withCookie(first));
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    const phone = sessions.find((s) => !s.current);
    expect(phone).toMatchObject({
      browser: 'Safari',
      os: 'iPhone',
      kind: 'mobile',
      ipMasked: '85.240.x.x',
    });
    const text = JSON.stringify(sessions);
    expect(text).not.toContain('85.240.12.34');
    expect(text).not.toMatch(/token/i);
    expect(Object.keys(sessions[0] ?? {}).sort()).toEqual(
      [
        'browser',
        'createdAt',
        'current',
        'expiresAt',
        'id',
        'ipMasked',
        'kind',
        'lastActiveAt',
        'os',
      ].sort(),
    );
    expect(second).not.toBe('');
  });

  it('ends one session and its cookie stops working at once', async () => {
    const mac = await register('ana@example.com');
    const phone = await signIn('ana@example.com', SAFARI_IPHONE);
    const { sessions } = await account.listSessions(withCookie(mac));
    const target = sessions.find((s) => !s.current);

    await account.revokeSession(withCookie(mac), target?.id ?? '');

    expect(await auth.api.getSession({ headers: withCookie(phone) })).toBeNull();
    expect(await auth.api.getSession({ headers: withCookie(mac) })).not.toBeNull();
    expect((await account.listSessions(withCookie(mac))).sessions).toHaveLength(1);
  });

  it("answers 404 for somebody else's session, an unknown id and a malformed one", async () => {
    const ana = await register('ana@example.com');
    const rui = await register('rui@example.com');
    const ruiSession = (await account.listSessions(withCookie(rui))).sessions[0];

    for (const id of [ruiSession?.id ?? '', crypto.randomUUID(), "' OR 1=1 --", '']) {
      await expect(account.revokeSession(withCookie(ana), id)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    }
    // Rui is still signed in.
    expect(await auth.api.getSession({ headers: withCookie(rui) })).not.toBeNull();
  });

  it('ends every other session and keeps the current one', async () => {
    const mac = await register('ana@example.com');
    const phone = await signIn('ana@example.com', SAFARI_IPHONE);
    const other = await register('rui@example.com');

    expect(await account.revokeOtherSessions(withCookie(mac))).toEqual({ revoked: 1 });
    expect(await auth.api.getSession({ headers: withCookie(phone) })).toBeNull();
    expect(await auth.api.getSession({ headers: withCookie(mac) })).not.toBeNull();
    expect(await auth.api.getSession({ headers: withCookie(other) })).not.toBeNull();
  });

  it('needs a session for everything', async () => {
    const none = new Headers();
    await expect(account.getMe(none)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(account.listSessions(none)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(account.revokeSession(none, crypto.randomUUID())).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(account.revokeOtherSessions(none)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(account.updateProfile(none, { name: 'x' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});

describe('profile', () => {
  it('returns the profile and changes only the name', async () => {
    const cookie = await register('ana@example.com');
    expect(await account.getMe(withCookie(cookie))).toMatchObject({
      name: 'Ana',
      email: 'ana@example.com',
      emailVerified: true,
    });
    const updated = await account.updateProfile(withCookie(cookie), { name: '  Ana Silva ' });
    expect(updated.name).toBe('Ana Silva');
    expect(updated.email).toBe('ana@example.com');
  });

  it('rejects an empty name and extra fields', async () => {
    const cookie = await register('ana@example.com');
    await expect(account.updateProfile(withCookie(cookie), { name: ' ' })).rejects.toThrow();
    await expect(
      account.updateProfile(withCookie(cookie), { name: 'Ana', email: 'x@y.pt' }),
    ).rejects.toThrow();
    await expect(
      account.updateProfile(withCookie(cookie), { name: 'Ana', emailVerified: true }),
    ).rejects.toThrow();
    expect((await account.getMe(withCookie(cookie))).email).toBe('ana@example.com');
  });
});

describe('change password', () => {
  it('ends the other sessions, keeps this one and emails a notice', async () => {
    const mac = await register('ana@example.com');
    const phone = await signIn('ana@example.com', SAFARI_IPHONE);

    const res = await postAuth(
      auth,
      '/change-password',
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, revokeOtherSessions: true },
      { cookie: mac },
    );
    expect(res.status).toBe(200);
    expect(await auth.api.getSession({ headers: withCookie(phone) })).toBeNull();
    const fresh = cookieOf(res);
    expect(await auth.api.getSession({ headers: withCookie(fresh) })).not.toBeNull();

    await vi.waitFor(() => {
      expect(mail.sent.some((m) => m.subject === 'A tua palavra-passe foi alterada')).toBe(true);
    });
    expect(mail.sent.at(-1)?.to).toBe('ana@example.com');
    expect(JSON.stringify(await res.json())).not.toContain(NEW_PASSWORD);
  });

  it('rejects a new password that contains the account email, and a common one', async () => {
    const cookie = await register('ana.silva@example.com');
    const change = async (newPassword: string) => {
      const res = await postAuth(
        auth,
        '/change-password',
        { currentPassword: PASSWORD, newPassword },
        { cookie },
      );
      return { status: res.status, code: ((await res.json()) as { code?: string }).code };
    };
    expect(await change('xx-ana.silva@example.com-xx')).toEqual({
      status: 400,
      code: 'PASSWORD_BASED_ON_EMAIL',
    });
    expect(await change('palavra-passe')).toEqual({ status: 400, code: 'PASSWORD_TOO_COMMON' });
    expect((await change(NEW_PASSWORD)).status).toBe(200);
  });

  it('answers 400 for a wrong current password and limits the attempts', async () => {
    const cookie = await register('ana@example.com');
    const attempt = () =>
      postAuth(
        auth,
        '/change-password',
        { currentPassword: 'not-the-right-passphrase', newPassword: NEW_PASSWORD },
        { cookie, 'x-forwarded-for': '85.240.12.34' },
      );
    for (let i = 0; i < 5; i += 1) expect((await attempt()).status).toBe(400);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('keeps the limit per account, not per address', async () => {
    const ana = await register('ana@example.com');
    const rui = await register('rui@example.com');
    const wrong = (cookie: string, ip: string) =>
      postAuth(
        auth,
        '/change-password',
        { currentPassword: 'not-the-right-passphrase', newPassword: NEW_PASSWORD },
        { cookie, 'x-forwarded-for': ip },
      );
    for (let i = 0; i < 5; i += 1) await wrong(ana, `10.0.0.${i}`);
    expect((await wrong(ana, '10.0.1.1')).status).toBe(429);
    expect((await wrong(rui, '10.0.2.2')).status).toBe(400);
  });
});

describe('change email', () => {
  it('sends the link to the new address and changes the email only once it is used', async () => {
    const cookie = await register('ana@example.com');
    const res = await postAuth(
      auth,
      '/change-email',
      { newEmail: 'ana.new@example.com' },
      { cookie },
    );
    expect(res.status).toBe(200);

    await vi.waitFor(() => {
      expect(mail.sent.some((m) => m.to === 'ana.new@example.com')).toBe(true);
    });
    expect((await account.getMe(withCookie(cookie))).email).toBe('ana@example.com');

    const message = mail.sent.find((m) => m.to === 'ana.new@example.com');
    const token = new RegExp(`${APP_URL}/verificar/([^\\s"<]+)`).exec(message?.text ?? '')?.[1];
    expect(token).toBeTruthy();
    expect(await verifyEmailWithToken(auth, token ?? '')).toBe(true);
    expect((await account.getMe(withCookie(cookie))).email).toBe('ana.new@example.com');
  });

  it('answers the same for an address that is already taken', async () => {
    const cookie = await register('ana@example.com');
    await register('rui@example.com');
    mail.clear();
    const taken = await postAuth(
      auth,
      '/change-email',
      { newEmail: 'rui@example.com' },
      { cookie },
    );
    const free = await postAuth(
      auth,
      '/change-email',
      { newEmail: 'free@example.com' },
      { cookie },
    );
    expect(taken.status).toBe(free.status);
    expect(await taken.json()).toEqual(await free.json());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mail.sent.some((m) => m.to === 'rui@example.com')).toBe(false);
  });
});
