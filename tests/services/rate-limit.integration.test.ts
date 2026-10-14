import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { testEnv } from '@nestvault/config/node';
import { createIdentityDatabase } from '@nestvault/db';
import {
  createAuth,
  createRateLimiter,
  RATE_LIMIT_BUCKETS,
  RateLimitError,
  type Auth,
  type RateLimiter,
} from '@nestvault/services';

import { openTestDatabase } from '../db/harness';
import { APP_URL, PASSWORD, postAuth, registerUser, SECRET } from '../support/auth-harness';

const testDb = openTestDatabase();
const identity = createIdentityDatabase(testEnv().TEST_DATABASE_URL_IDENTITY, 10);

let clock = new Date('2026-01-01T10:00:00Z');
const advance = (seconds: number) => (clock = new Date(clock.getTime() + seconds * 1000));
const limiter = (extra: { cleanupEvery?: number } = {}): RateLimiter =>
  createRateLimiter({ identity, secret: SECRET, now: () => clock, ...extra });

async function rows(query: ReturnType<typeof sql>) {
  return (await identity.db.execute(query)).rows;
}

async function retryAfterOf(promise: Promise<unknown>): Promise<number> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(RateLimitError);
  return (error as RateLimitError).retryAfterSeconds;
}

beforeEach(async () => {
  await testDb.truncateAll();
  clock = new Date('2026-01-01T10:00:00Z');
});
afterAll(async () => {
  await identity.close();
  await testDb.close();
});

describe('rate limiter', () => {
  it('allows the limit and rejects the next hit with the seconds until the window ends', async () => {
    const rl = limiter();
    for (let i = 0; i < 5; i += 1) await rl.consume('auth.signin.email', 'ana@example.com');
    advance(60);
    expect(await retryAfterOf(rl.consume('auth.signin.email', 'ana@example.com'))).toBe(14 * 60);
  });

  it('keeps keys and buckets apart', async () => {
    const rl = limiter();
    for (let i = 0; i < 5; i += 1) await rl.consume('auth.signin.ip', '203.0.113.9');
    await expect(rl.consume('auth.signin.ip', '203.0.113.10')).resolves.toBeDefined();
    await expect(rl.consume('auth.reset.ip', '203.0.113.9')).resolves.toBeDefined();
    await expect(rl.consume('auth.signin.ip', '203.0.113.9')).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it('starts again when the window has passed', async () => {
    const rl = limiter();
    for (let i = 0; i < 5; i += 1) await rl.consume('auth.signin.ip', '203.0.113.9');
    await expect(rl.consume('auth.signin.ip', '203.0.113.9')).rejects.toBeInstanceOf(
      RateLimitError,
    );
    advance(15 * 60);
    await expect(rl.consume('auth.signin.ip', '203.0.113.9')).resolves.toBeDefined();
  });

  it('does not let parallel requests bypass the limit', async () => {
    const rl = limiter();
    const results = await Promise.allSettled(
      Array.from({ length: 40 }, () => rl.consume('auth.signin.email', 'ana@example.com')),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(35);
  });

  it('gives a hit back on release, never below zero', async () => {
    const rl = limiter();
    const hits = [];
    for (let i = 0; i < 5; i += 1) hits.push(await rl.consume('auth.signin.ip', '203.0.113.9'));
    await hits[0]?.release();
    await expect(rl.consume('auth.signin.ip', '203.0.113.9')).resolves.toBeDefined();
    await rl.release('auth.signin.email', 'nobody@example.com');
    const [row] = await rows(sql`select count(*)::int as n from rate_limits where count < 0`);
    expect(row?.n).toBe(0);
  });

  it('uses the limits of the task', () => {
    expect(RATE_LIMIT_BUCKETS['auth.signin.ip']).toMatchObject({ limit: 5, windowSeconds: 900 });
    expect(RATE_LIMIT_BUCKETS['auth.signin.untrusted']).toMatchObject({ limit: 50 });
    expect(RATE_LIMIT_BUCKETS['auth.reset.email']).toMatchObject({ limit: 5, windowSeconds: 900 });
    expect(RATE_LIMIT_BUCKETS.api).toMatchObject({ limit: 300, windowSeconds: 60 });
    expect(RATE_LIMIT_BUCKETS.imports).toMatchObject({ limit: 20, windowSeconds: 3600 });
    expect(RATE_LIMIT_BUCKETS.invites).toMatchObject({ limit: 20, windowSeconds: 86400 });
  });

  it('stores neither the email nor the address in clear', async () => {
    await limiter().consume('auth.signin.email', 'ana@example.com');
    await limiter().consume('auth.signin.ip', '203.0.113.9');
    const dump = JSON.stringify(await rows(sql`select * from rate_limits`));
    expect(dump).not.toContain('ana@example.com');
    expect(dump).not.toContain('203.0.113.9');
  });

  it('treats an injection payload as data', async () => {
    const rl = limiter();
    const payload = "' OR 1=1; DROP TABLE rate_limits; --";
    await rl.consume('auth.signin.email', payload);
    await rl.consume('auth.signin.email', payload);
    const all = await rows(sql`select count from rate_limits`);
    expect(all).toEqual([{ count: 2 }]);
  });

  it('deletes expired windows lazily', async () => {
    const rl = limiter({ cleanupEvery: 1 });
    await rl.consume('auth.signin.ip', '203.0.113.9');
    advance(16 * 60);
    await rl.consume('auth.signin.ip', '203.0.113.10');
    await new Promise((resolve) => setTimeout(resolve, 100));
    const left = await rows(sql`select count(*)::int as n from rate_limits`);
    expect(left[0]?.n).toBe(1);
  });

  it('fails closed for auth buckets and open for the API when the database is down', async () => {
    const broken = createIdentityDatabase(testEnv().TEST_DATABASE_URL_IDENTITY, 1);
    await broken.close();
    const rl = createRateLimiter({ identity: broken, secret: SECRET });
    await expect(rl.consume('auth.signin.ip', '203.0.113.9')).rejects.not.toBeInstanceOf(
      RateLimitError,
    );
    await expect(rl.consume('api', 'session-id')).resolves.toBeDefined();
  });
});

describe('rate limits on the auth routes', () => {
  function build(trustedProxyHops = 0): Auth {
    return createAuth({
      identity,
      appUrl: APP_URL,
      secret: SECRET,
      allowSignup: true,
      limiter: limiter(),
      trustedProxyHops,
      checkBreached: () => Promise.resolve(false),
    });
  }

  const signIn = (auth: Auth, email: string, password: string, headers = {}) =>
    postAuth(auth, '/sign-in/email', { email, password }, headers);

  async function register(auth: Auth, email: string) {
    await registerUser(auth, identity, email);
  }

  it('answers the 6th failed sign-in for one email with 429 and Retry-After (any IP)', async () => {
    const auth = build(1);
    await register(auth, 'ana@example.com');
    for (let i = 0; i < 5; i += 1) {
      const res = await signIn(auth, 'ana@example.com', 'wrong-password-123', {
        'x-forwarded-for': `203.0.113.${String(i + 1)}`,
      });
      expect(res.status).toBe(401);
    }
    const blocked = await signIn(auth, 'ana@example.com', PASSWORD, {
      'x-forwarded-for': '203.0.113.200',
    });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('answers the 6th failed sign-in from one IP with 429 (different emails)', async () => {
    const auth = build(1);
    for (let i = 0; i < 5; i += 1) {
      const res = await signIn(auth, `user${String(i)}@example.com`, 'wrong-password-123', {
        'x-forwarded-for': '203.0.113.9',
      });
      expect(res.status).toBe(401);
    }
    const blocked = await signIn(auth, 'other@example.com', 'wrong-password-123', {
      'x-forwarded-for': '203.0.113.9',
    });
    expect(blocked.status).toBe(429);
    const elsewhere = await signIn(auth, 'other@example.com', 'wrong-password-123', {
      'x-forwarded-for': '203.0.113.77',
    });
    expect(elsewhere.status).toBe(401);
  });

  it('does not count successful sign-ins', async () => {
    const auth = build(1);
    await register(auth, 'ana@example.com');
    for (let i = 0; i < 12; i += 1) {
      const res = await signIn(auth, 'ana@example.com', PASSWORD, {
        'x-forwarded-for': '203.0.113.9',
      });
      expect(res.status).toBe(200);
    }
  });

  it('ignores a spoofed x-forwarded-for without a trusted proxy, with a loose shared limit', async () => {
    const auth = build(0);
    // Rotating the header does not escape the shared per-IP limit (50, not 5).
    for (let i = 0; i < 50; i += 1) {
      const res = await signIn(auth, `user${String(i)}@example.com`, 'wrong-password-123', {
        'x-forwarded-for': `198.51.100.${String(i + 1)}`,
      });
      expect(res.status).toBe(401);
    }
    const res = await signIn(auth, 'another@example.com', 'wrong-password-123', {
      'x-forwarded-for': '198.51.100.250',
    });
    expect(res.status).toBe(429);
  });

  it('does not lock everybody out when one person fails 5 times without a trusted proxy', async () => {
    const auth = build(0);
    await register(auth, 'bia@example.com');
    for (let i = 0; i < 6; i += 1) {
      await signIn(auth, 'ana@example.com', 'wrong-password-123');
    }
    expect((await signIn(auth, 'ana@example.com', 'wrong-password-123')).status).toBe(429);
    expect((await signIn(auth, 'bia@example.com', PASSWORD)).status).toBe(200);
  });

  it('gives the hit back after a successful sign-in without a trusted proxy too', async () => {
    const auth = build(0);
    await register(auth, 'ana@example.com');
    for (let i = 0; i < 55; i += 1) {
      expect((await signIn(auth, 'ana@example.com', PASSWORD)).status).toBe(200);
    }
  });

  it('limits password reset per email', async () => {
    const auth = build(1);
    for (let i = 0; i < 5; i += 1) {
      const res = await postAuth(
        auth,
        '/request-password-reset',
        { email: 'ana@example.com' },
        {
          'x-forwarded-for': `203.0.113.${String(i + 1)}`,
        },
      );
      expect(res.status).not.toBe(429);
    }
    const blocked = await postAuth(
      auth,
      '/request-password-reset',
      { email: 'ana@example.com' },
      {
        'x-forwarded-for': '203.0.113.200',
      },
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).not.toBeNull();
  });
});
