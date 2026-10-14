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
import { verifyAllUsers } from '../support/verify-users';

const APP_URL = 'http://localhost:4000';
const PASSWORD = 'a-long-unique-passphrase';
const NEW_PASSWORD = 'another-long-unique-passphrase';
const SECRET = 'x'.repeat(40);

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

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  auth.handler(
    new Request(`${APP_URL}/api/v1/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP_URL, ...headers },
      body: JSON.stringify(body),
    }),
  );

async function register(email = 'ana@example.com', { verified = true } = {}) {
  const res = await post('/sign-up/email', { name: 'Ana <b>', email, password: PASSWORD });
  expect(res.status).toBe(200);
  // Sign-up sends its own verification email; the tests below look at what comes after it.
  await vi.waitFor(() => {
    expect(mail.sent).toHaveLength(1);
  });
  mail.clear();
  if (verified) await verifyAllUsers(identity);
}

async function waitForMail(count = 1) {
  await vi.waitFor(() => {
    expect(mail.sent.length).toBeGreaterThanOrEqual(count);
  });
  return mail.sent[count - 1] as (typeof mail.sent)[number];
}

const tokenIn = (text: string, page: string) =>
  new RegExp(`${APP_URL}/${page}/([^\\s"<]+)`).exec(text)?.[1] ?? '';

async function rows(query: ReturnType<typeof sql>) {
  return (await identity.db.execute(query)).rows;
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
    const res = await post('/request-password-reset', { email: 'ana@example.com' });
    expect(res.status).toBe(200);

    const message = await waitForMail();
    expect(message.to).toBe('ana@example.com');
    expect(message.subject).toBe('Recuperar a palavra-passe');
    expect(message.html).toContain('Ana &lt;b&gt;'); // the name is escaped
    const token = tokenIn(message.text, 'recuperar');
    expect(token).not.toBe('');
    expect(await isResetTokenValid(auth, token)).toBe(true);

    const first = await post('/reset-password', { token, newPassword: NEW_PASSWORD });
    expect(first.status).toBe(200);
    const second = await post('/reset-password', { token, newPassword: 'yet-another-passphrase' });
    expect(second.status).toBe(400);
    expect(await isResetTokenValid(auth, token)).toBe(false);

    const signIn = (password: string) =>
      post('/sign-in/email', { email: 'ana@example.com', password });
    expect((await signIn(NEW_PASSWORD)).status).toBe(200);
    expect((await signIn(PASSWORD)).status).toBe(401);
  });

  it('answers the same for an account that exists and one that does not', async () => {
    await register();
    const known = await post('/request-password-reset', { email: 'ana@example.com' });
    const unknown = await post('/request-password-reset', { email: 'nobody@example.com' });
    expect(unknown.status).toBe(known.status);
    expect(await unknown.json()).toEqual(await known.json());
    await waitForMail();
    expect(mail.sent).toHaveLength(1); // nothing is sent to the unknown address
  });

  it('rejects an expired token', async () => {
    await register();
    await post('/request-password-reset', { email: 'ana@example.com' });
    const token = tokenIn((await waitForMail()).text, 'recuperar');
    await identity.db.execute(
      sql`update verification set expires_at = now() - interval '1 minute'`,
    );
    expect(await isResetTokenValid(auth, token)).toBe(false);
    const res = await post('/reset-password', { token, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
  });

  it('rejects a token of the wrong shape without touching the database', async () => {
    expect(await isResetTokenValid(auth, '')).toBe(false);
    expect(await isResetTokenValid(auth, "' OR 1=1 --")).toBe(false);
    expect(await isResetTokenValid(auth, 'a'.repeat(500))).toBe(false);
  });

  it('ends every session, and tells the owner by email', async () => {
    await register();
    const signedIn = await post('/sign-in/email', { email: 'ana@example.com', password: PASSWORD });
    const cookie = signedIn.headers.get('set-cookie')?.split(';')[0] ?? '';
    expect(await getOptionalSession(auth, new Headers({ cookie }))).not.toBeNull();

    await post('/request-password-reset', { email: 'ana@example.com' });
    const token = tokenIn((await waitForMail()).text, 'recuperar');
    expect((await post('/reset-password', { token, newPassword: NEW_PASSWORD })).status).toBe(200);

    expect(await getOptionalSession(auth, new Headers({ cookie }))).toBeNull();
    expect(await rows(sql`select 1 from session`)).toHaveLength(0);
    const notice = await waitForMail(2);
    expect(notice.subject).toBe('A tua palavra-passe foi alterada');
    expect(notice.text).not.toContain(token);
  });

  it('stores the token hashed and never logs it', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    try {
      await register();
      await post('/request-password-reset', { email: 'ana@example.com' });
      await post('/request-password-reset', { email: 'nobody@example.com' });
      const token = tokenIn((await waitForMail()).text, 'recuperar');
      await post('/reset-password', { token, newPassword: NEW_PASSWORD });

      const stored = JSON.stringify(await rows(sql`select identifier, value from verification`));
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
      expect((await post('/request-password-reset', { email: 'ana@example.com' })).status).toBe(
        200,
      );
    }
    const blocked = await post('/request-password-reset', { email: 'ana@example.com' });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).not.toBeNull();
  });

  it('keeps the verification resend limit apart from the reset limit', async () => {
    await register();
    for (let i = 0; i < 5; i += 1) {
      expect((await post('/send-verification-email', { email: 'ana@example.com' })).status).toBe(
        200,
      );
    }
    expect((await post('/send-verification-email', { email: 'ana@example.com' })).status).toBe(429);
    // A password reset is still possible for the same email.
    expect((await post('/request-password-reset', { email: 'ana@example.com' })).status).toBe(200);
  });
});

describe('email verification', () => {
  it('marks the email as verified with the link of the email, and rejects a forged token', async () => {
    await register('ana@example.com', { verified: false });
    expect(await rows(sql`select email_verified from "user"`)).toEqual([{ email_verified: false }]);

    expect((await post('/send-verification-email', { email: 'ana@example.com' })).status).toBe(200);
    const message = await waitForMail();
    expect(message.subject).toBe('Confirma o teu email');
    const token = decodeURIComponent(tokenIn(message.text, 'verificar'));
    expect(token).not.toBe('');

    expect(await verifyEmailWithToken(auth, `${token}x`)).toBe(false);
    expect(await verifyEmailWithToken(auth, 'not-a-token')).toBe(false);
    expect(await rows(sql`select email_verified from "user"`)).toEqual([{ email_verified: false }]);

    expect(await verifyEmailWithToken(auth, token)).toBe(true);
    expect(await rows(sql`select email_verified from "user"`)).toEqual([{ email_verified: true }]);
  });

  it('answers the same for an unknown email when resending', async () => {
    await register('ana@example.com', { verified: false });
    const known = await post('/send-verification-email', { email: 'ana@example.com' });
    const unknown = await post('/send-verification-email', { email: 'nobody@example.com' });
    expect(unknown.status).toBe(known.status);
  });
});
