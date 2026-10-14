import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { testEnv } from '@nestvault/config/node';
import { createIdentityDatabase } from '@nestvault/db';
import {
  createAuth,
  createMemoryEmailSender,
  getOptionalSession,
  isResetTokenValid,
  verifyEmailWithToken,
  type Auth,
  type MemoryEmailSender,
} from '@nestvault/services';

import { openTestDatabase } from '../db/harness';
import {
  APP_URL,
  PASSWORD,
  postAuth,
  registerUser,
  rows,
  SECRET,
  tokenIn,
  waitForMail,
} from '../support/auth-harness';

const NEW_PASSWORD = 'another-long-unique-passphrase';

const testDb = openTestDatabase();
const identity = createIdentityDatabase(testEnv().TEST_DATABASE_URL_IDENTITY, 4);

let mail: MemoryEmailSender;
let auth: Auth;
const logged: unknown[] = [];

function build() {
  mail = createMemoryEmailSender();
  auth = createAuth({
    identity,
    appUrl: APP_URL,
    secret: SECRET,
    allowSignup: true,
    email: mail,
    // Every log call the app makes is kept so the tests can look for tokens in it.
    log: {
      error: (...args: unknown[]) => logged.push(args),
      warn: (...args: unknown[]) => logged.push(args),
      info: (...args: unknown[]) => logged.push(args),
      debug: (...args: unknown[]) => logged.push(args),
      child() {
        return this;
      },
    } as never,
    checkBreached: () => Promise.resolve(false),
  });
}

async function register(email = 'ana@example.com', { verified = true } = {}) {
  await registerUser(auth, identity, email, { verified, name: 'Ana <b>' });
  // Sign-up sends its own verification email; the tests below look at what comes after it.
  await waitForMail(mail);
  mail.clear();
}

beforeEach(async () => {
  await testDb.truncateAll();
  logged.length = 0;
  build();
});
afterAll(async () => {
  await identity.close();
  await testDb.close();
});

describe('password reset', () => {
  it('sends a pt-PT email with a link to /recuperar/<token> that works once', async () => {
    await register();
    const res = await postAuth(auth, '/request-password-reset', { email: 'ana@example.com' });
    expect(res.status).toBe(200);

    const message = await waitForMail(mail);
    expect(message.to).toBe('ana@example.com');
    expect(message.subject).toBe('Recuperar a palavra-passe');
    expect(message.html).toContain('Ana &lt;b&gt;'); // the name is escaped
    const token = tokenIn(message.text, 'recuperar');
    expect(token).not.toBe('');
    expect(await isResetTokenValid(auth, token)).toBe(true);

    const first = await postAuth(auth, '/reset-password', { token, newPassword: NEW_PASSWORD });
    expect(first.status).toBe(200);
    const second = await postAuth(auth, '/reset-password', {
      token,
      newPassword: 'yet-another-passphrase',
    });
    expect(second.status).toBe(400);
    expect(await isResetTokenValid(auth, token)).toBe(false);

    const signIn = (password: string) =>
      postAuth(auth, '/sign-in/email', { email: 'ana@example.com', password });
    expect((await signIn(NEW_PASSWORD)).status).toBe(200);
    expect((await signIn(PASSWORD)).status).toBe(401);
  });

  it('applies the password rules to the reset, including the email of the token owner', async () => {
    await register('ana.silva@example.com');
    await postAuth(auth, '/request-password-reset', { email: 'ana.silva@example.com' });
    const token = tokenIn((await waitForMail(mail)).text, 'recuperar');
    const reset = async (newPassword: string) => {
      const res = await postAuth(auth, '/reset-password', { token, newPassword });
      return { status: res.status, code: ((await res.json()) as { code?: string }).code };
    };
    expect(await reset('xx-ana.silva@example.com-xx')).toEqual({
      status: 400,
      code: 'PASSWORD_BASED_ON_EMAIL',
    });
    expect(await reset('palavra-passe')).toEqual({ status: 400, code: 'PASSWORD_TOO_COMMON' });
    // The token was not used up by the rejected attempts.
    expect((await reset(NEW_PASSWORD)).status).toBe(200);
  });

  it('answers the same for an account that exists and one that does not', async () => {
    await register();
    const known = await postAuth(auth, '/request-password-reset', { email: 'ana@example.com' });
    const unknown = await postAuth(auth, '/request-password-reset', {
      email: 'nobody@example.com',
    });
    expect(unknown.status).toBe(known.status);
    expect(await unknown.json()).toEqual(await known.json());
    await waitForMail(mail);
    expect(mail.sent).toHaveLength(1); // nothing is sent to the unknown address
  });

  it('rejects an expired token', async () => {
    await register();
    await postAuth(auth, '/request-password-reset', { email: 'ana@example.com' });
    const token = tokenIn((await waitForMail(mail)).text, 'recuperar');
    await identity.db.execute(
      sql`update verification set expires_at = now() - interval '1 minute'`,
    );
    expect(await isResetTokenValid(auth, token)).toBe(false);
    const res = await postAuth(auth, '/reset-password', { token, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
  });

  it('rejects a token of the wrong shape without touching the database', async () => {
    expect(await isResetTokenValid(auth, '')).toBe(false);
    expect(await isResetTokenValid(auth, "' OR 1=1 --")).toBe(false);
    expect(await isResetTokenValid(auth, 'a'.repeat(500))).toBe(false);
  });

  it('ends every session, and tells the owner by email', async () => {
    await register();
    const signedIn = await postAuth(auth, '/sign-in/email', {
      email: 'ana@example.com',
      password: PASSWORD,
    });
    const cookie = signedIn.headers.get('set-cookie')?.split(';')[0] ?? '';
    expect(await getOptionalSession(auth, new Headers({ cookie }))).not.toBeNull();

    await postAuth(auth, '/request-password-reset', { email: 'ana@example.com' });
    const token = tokenIn((await waitForMail(mail)).text, 'recuperar');
    expect(
      (await postAuth(auth, '/reset-password', { token, newPassword: NEW_PASSWORD })).status,
    ).toBe(200);

    expect(await getOptionalSession(auth, new Headers({ cookie }))).toBeNull();
    expect(await rows(identity, sql`select 1 from session`)).toHaveLength(0);
    const notice = await waitForMail(mail, 2);
    expect(notice.subject).toBe('A tua palavra-passe foi alterada');
    expect(notice.text).not.toContain(token);
  });

  it('stores the token hashed and never logs it', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    try {
      await register();
      await postAuth(auth, '/request-password-reset', { email: 'ana@example.com' });
      await postAuth(auth, '/request-password-reset', { email: 'nobody@example.com' });
      const token = tokenIn((await waitForMail(mail)).text, 'recuperar');
      await postAuth(auth, '/reset-password', { token, newPassword: NEW_PASSWORD });

      const stored = JSON.stringify(
        await rows(identity, sql`select identifier, value from verification`),
      );
      expect(stored).not.toContain(token);
      const output = JSON.stringify([logged, ...spies.map((spy) => spy.mock.calls)]);
      expect(output).not.toContain(token);
      expect(output).not.toContain('ana@example.com');
    } finally {
      spies.forEach((spy) => {
        spy.mockRestore();
      });
    }
  });

  it('limits reset requests to 5 per email', async () => {
    await register();
    for (let i = 0; i < 5; i += 1) {
      expect(
        (await postAuth(auth, '/request-password-reset', { email: 'ana@example.com' })).status,
      ).toBe(200);
    }
    const blocked = await postAuth(auth, '/request-password-reset', { email: 'ana@example.com' });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).not.toBeNull();
  });

  it('keeps the verification resend limit apart from the reset limit', async () => {
    await register();
    for (let i = 0; i < 5; i += 1) {
      expect(
        (await postAuth(auth, '/send-verification-email', { email: 'ana@example.com' })).status,
      ).toBe(200);
    }
    expect(
      (await postAuth(auth, '/send-verification-email', { email: 'ana@example.com' })).status,
    ).toBe(429);
    // A password reset is still possible for the same email.
    expect(
      (await postAuth(auth, '/request-password-reset', { email: 'ana@example.com' })).status,
    ).toBe(200);
  });
});

describe('email verification', () => {
  it('marks the email as verified with the link of the email, and rejects a forged token', async () => {
    await register('ana@example.com', { verified: false });
    expect(await rows(identity, sql`select email_verified from "user"`)).toEqual([
      { email_verified: false },
    ]);

    expect(
      (await postAuth(auth, '/send-verification-email', { email: 'ana@example.com' })).status,
    ).toBe(200);
    const message = await waitForMail(mail);
    expect(message.subject).toBe('Confirma o teu email');
    const token = tokenIn(message.text, 'verificar');
    expect(token).not.toBe('');

    expect(await verifyEmailWithToken(auth, `${token}x`)).toBe(false);
    expect(await verifyEmailWithToken(auth, 'not-a-token')).toBe(false);
    expect(await rows(identity, sql`select email_verified from "user"`)).toEqual([
      { email_verified: false },
    ]);

    expect(await verifyEmailWithToken(auth, token)).toBe(true);
    expect(await rows(identity, sql`select email_verified from "user"`)).toEqual([
      { email_verified: true },
    ]);
  });

  it('answers the same for an unknown email when resending', async () => {
    await register('ana@example.com', { verified: false });
    const known = await postAuth(auth, '/send-verification-email', { email: 'ana@example.com' });
    const unknown = await postAuth(auth, '/send-verification-email', {
      email: 'nobody@example.com',
    });
    expect(unknown.status).toBe(known.status);
  });
});
