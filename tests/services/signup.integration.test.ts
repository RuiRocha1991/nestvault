import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { testEnv } from '@nestvault/config/node';
import { createIdentityDatabase } from '@nestvault/db';
import {
  createAuth,
  createMemoryEmailSender,
  createRateLimiter,
  verifyEmailWithToken,
  type Auth,
  type MemoryEmailSender,
} from '@nestvault/services';

import { openTestDatabase } from '../db/harness';
import {
  APP_URL,
  createTestClock,
  PASSWORD,
  postAuth,
  SECRET,
  tokenIn,
  verifyEmail,
  waitForMail,
} from '../support/auth-harness';

const testDb = openTestDatabase();
const identity = createIdentityDatabase(testEnv().TEST_DATABASE_URL_IDENTITY, 4);

const clock = createTestClock();
let auth: Auth;
let mail: MemoryEmailSender;

function build(allowSignup = true, trustedProxyHops = 0) {
  mail = createMemoryEmailSender();
  auth = createAuth({
    identity,
    appUrl: APP_URL,
    secret: SECRET,
    allowSignup,
    email: mail,
    limiter: createRateLimiter({ identity, secret: SECRET, now: clock.now }),
    trustedProxyHops,
    checkBreached: () => Promise.resolve(false),
  });
}

const signUp = (email: string, password = PASSWORD, name = 'Ana', headers = {}) =>
  postAuth(auth, '/sign-up/email', { name, email, password }, headers);

const users = async () =>
  (await identity.db.execute(sql`select email, email_verified from "user"`)).rows;

beforeEach(async () => {
  await testDb.truncateAll();
  build();
});
afterAll(async () => {
  await identity.close();
  await testDb.close();
});

describe('sign-up with email verification', () => {
  it('creates an unverified account, sends the link and starts no session', async () => {
    const res = await signUp('ana@example.com');
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect((await res.json()) as { token: unknown }).toMatchObject({ token: null });
    expect(await users()).toEqual([{ email: 'ana@example.com', email_verified: false }]);

    const message = await waitForMail(mail);
    expect(message.to).toBe('ana@example.com');
    expect(message.subject).toBe('Confirma o teu email');
  });

  it('refuses to sign in before the link is used, and resends it; afterwards it works', async () => {
    await signUp('ana@example.com');
    const first = await waitForMail(mail);

    clock.advance(61); // past the one-a-minute limit on verification emails
    const early = await postAuth(auth, '/sign-in/email', {
      email: 'ana@example.com',
      password: PASSWORD,
    });
    expect(early.status).toBe(403);
    expect(early.headers.get('set-cookie')).toBeNull();
    expect(((await early.json()) as { code: string }).code).toBe('EMAIL_NOT_VERIFIED');
    await waitForMail(mail, 2);

    const token = tokenIn(first.text, 'verificar');
    expect(await verifyEmailWithToken(auth, token)).toBe(true);
    const late = await postAuth(auth, '/sign-in/email', {
      email: 'ana@example.com',
      password: PASSWORD,
    });
    expect(late.status).toBe(200);
    expect(late.headers.get('set-cookie')).toContain('nv.session_token=');
  });

  it('answers a registered email like a new one, creates nothing and warns the owner', async () => {
    await signUp('ana@example.com');
    await waitForMail(mail);
    mail.clear();
    await verifyEmail(identity, 'ana@example.com');

    const fresh = await signUp('bob@example.com');
    const again = await signUp('ana@example.com', PASSWORD, 'Intruder');
    expect(again.status).toBe(fresh.status);
    expect(again.headers.get('set-cookie')).toBeNull();
    const shape = async (res: Response) => {
      const body = (await res.json()) as { token: unknown; user: Record<string, unknown> };
      return { token: body.token, keys: Object.keys(body.user).sort() };
    };
    expect(await shape(again)).toEqual(await shape(fresh));

    expect(await users()).toHaveLength(2);
    await vi.waitFor(() => {
      expect(mail.sent.some((m) => m.subject === 'Já tens uma conta')).toBe(true);
    });
    const warning = mail.sent.find((m) => m.subject === 'Já tens uma conta');
    expect(warning?.to).toBe('ana@example.com');
    expect(warning?.text).toContain(`${APP_URL}/recuperar`);
  });

  it('sends a new verification link when the address exists but was never verified', async () => {
    await signUp('ana@example.com');
    await waitForMail(mail);
    mail.clear();

    clock.advance(61);
    expect((await signUp('ana@example.com')).status).toBe(200);
    const message = await waitForMail(mail);
    expect(message.subject).toBe('Confirma o teu email');
    expect(message.to).toBe('ana@example.com');
    const token = tokenIn(message.text, 'verificar');
    expect(await verifyEmailWithToken(auth, token)).toBe(true);
    expect(await users()).toHaveLength(1);
  });

  describe('limit on verification emails', () => {
    const verificationMails = () => mail.sent.filter((m) => m.subject === 'Confirma o teu email');

    it('sends one email a minute per address, from every entry point, with the same answer', async () => {
      await signUp('ana@example.com');
      await waitForMail(mail);
      // Asked again within the minute by sign-up, sign-in and the resend button: nothing more.
      const again = await signUp('ana@example.com');
      const signIn = await postAuth(auth, '/sign-in/email', {
        email: 'ana@example.com',
        password: PASSWORD,
      });
      const resend = await postAuth(auth, '/send-verification-email', { email: 'ana@example.com' });
      expect([again.status, signIn.status, resend.status]).toEqual([200, 403, 200]);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(verificationMails()).toHaveLength(1);

      clock.advance(61);
      await postAuth(auth, '/send-verification-email', { email: 'ana@example.com' });
      await waitForMail(mail, 2);
      expect(verificationMails()).toHaveLength(2);
    });

    it('stops at ten an hour for one address, and keeps other addresses apart', async () => {
      await signUp('ana@example.com');
      for (let i = 1; i < 10; i += 1) {
        clock.advance(181); // 5 requests per 15 minutes reach the resend endpoint
        await postAuth(auth, '/send-verification-email', { email: 'ana@example.com' });
        await waitForMail(mail, i + 1);
      }
      expect(verificationMails()).toHaveLength(10);
      clock.advance(181);
      const eleventh = await postAuth(auth, '/send-verification-email', {
        email: 'ana@example.com',
      });
      expect(eleventh.status).toBe(200); // same answer, no email
      await signUp('bob@example.com');
      await waitForMail(mail, 11);
      expect(verificationMails()).toHaveLength(11);
      expect(verificationMails().filter((m) => m.to === 'ana@example.com')).toHaveLength(10);
    }, 30_000);

    it('does not break sign-up when only the verification-mail counters fail', async () => {
      const real = createRateLimiter({ identity, secret: SECRET, now: clock.now });
      auth = createAuth({
        identity,
        appUrl: APP_URL,
        secret: SECRET,
        allowSignup: true,
        email: mail,
        limiter: {
          ...real,
          consume: (bucket, key) =>
            bucket.startsWith('auth.verifymail.')
              ? Promise.reject(new Error('counter down'))
              : real.consume(bucket, key),
        },
        checkBreached: () => Promise.resolve(false),
      });
      expect((await signUp('ana@example.com')).status).toBe(200);
      expect(await users()).toHaveLength(1);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(mail.sent).toHaveLength(0);
    });
  });

  it('answers 403 signup_closed when sign-up is closed', async () => {
    build(false);
    const res = await signUp('ana@example.com');
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('signup_closed');
    expect(await users()).toEqual([]);
    expect(mail.sent).toHaveLength(0);
  });

  it('rejects short, common and email-based passwords on the server', async () => {
    const code = async (password: string) =>
      (
        (await (
          await signUp(`p${String(Math.random()).slice(2)}@example.com`, password)
        ).json()) as { code?: string }
      ).code;
    expect(await code('short-pass')).toBe('PASSWORD_TOO_SHORT');
    expect(await code('palavra-passe')).toBe('PASSWORD_TOO_COMMON');
    expect(await code('qwertyuiop12')).toBe('PASSWORD_TOO_COMMON');
    expect(await code('aaaaaaaaaaaaaaaa')).toBe('PASSWORD_TOO_COMMON');

    const based = await signUp('ana.silva@example.com', 'xx-ana.silva@example.com-xx');
    expect(based.status).toBe(400);
    expect(((await based.json()) as { code: string }).code).toBe('PASSWORD_BASED_ON_EMAIL');
    const local = await signUp('anabelasilva@example.com', 'my-anabelasilva-secret');
    expect(((await local.json()) as { code: string }).code).toBe('PASSWORD_BASED_ON_EMAIL');
    expect(await users()).toEqual([]);
  });

  it('stores the name and email literally (injection payloads are data)', async () => {
    const payload = 'x\'); DROP TABLE "user"; --';
    const res = await signUp('ana@example.com', PASSWORD, payload);
    expect(res.status).toBe(200);
    const rows = (await identity.db.execute(sql`select name from "user"`)).rows;
    expect(rows).toEqual([{ name: payload }]);
  });

  it('limits sign-ups per address: the 6th in the window is 429 with Retry-After', async () => {
    build(true, 1);
    const ip = { 'x-forwarded-for': '198.51.100.7' };
    for (let i = 0; i < 5; i += 1) {
      expect((await signUp(`user${String(i)}@example.com`, PASSWORD, 'Ana', ip)).status).toBe(200);
    }
    const blocked = await signUp('another@example.com', PASSWORD, 'Ana', ip);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    const elsewhere = await signUp('other@example.com', PASSWORD, 'Ana', {
      'x-forwarded-for': '198.51.100.8',
    });
    expect(elsewhere.status).toBe(200);
  });

  it('a password reset also confirms the address (the link came by email)', async () => {
    await signUp('ana@example.com');
    await waitForMail(mail);
    mail.clear();
    await postAuth(auth, '/request-password-reset', { email: 'ana@example.com' });
    const message = await waitForMail(mail);
    const token = new RegExp(`${APP_URL}/recuperar/([^\\s"<]+)`).exec(message.text)?.[1] ?? '';
    const done = await postAuth(auth, '/reset-password', {
      token,
      newPassword: 'another-long-unique-passphrase',
    });
    expect(done.status).toBe(200);
    expect(await users()).toEqual([{ email: 'ana@example.com', email_verified: true }]);
  });
});
