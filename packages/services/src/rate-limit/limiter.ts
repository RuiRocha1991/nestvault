import { createHmac } from 'node:crypto';

import { rateLimitsRepo, type IdentityDatabase, type WindowKey } from '@nestvault/db';

import { RateLimitError } from '../errors';
import type { Logger } from '../logger';

import { RATE_LIMIT_BUCKETS, type RateLimitBucket } from './buckets';

export interface RateLimiterConfig {
  identity: IdentityDatabase;
  /** Keys the HMAC that hides IPs and emails in the table. */
  secret: string;
  log?: Logger;
  /** Tests move the clock. */
  now?: () => Date;
  /** One in this many hits also deletes expired windows (lazy cleanup). 0 turns it off. */
  cleanupEvery?: number;
}

/** A counted hit. `release()` gives it back (a successful sign-in is not a failed attempt). */
export interface Hit {
  release(): Promise<void>;
}

const NOOP_HIT: Hit = { release: () => Promise.resolve() };

export interface RateLimiter {
  /**
   * Counts one hit for `key` in `bucket` and throws `RateLimitError` (429, with the seconds until
   * the window ends) once the limit is passed. The hit is counted *before* the work it guards, in one
   * atomic upsert, so parallel requests cannot all pass a check-then-increment race.
   */
  consume(bucket: RateLimitBucket, key: string): Promise<Hit>;
  /** Gives back one hit in the current window of `key` (same effect as `Hit.release()`). */
  release(bucket: RateLimitBucket, key: string): Promise<void>;
}

/** Postgres-backed fixed-window limiter (no Redis): `nestvault_identity.rate_limits`. */
export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  const now = config.now ?? (() => new Date());
  const cleanupEvery = config.cleanupEvery ?? 200;
  let hits = 0;

  const keyHash = (bucket: string, key: string) =>
    createHmac('sha256', config.secret).update(`${bucket}\0${key.toLowerCase()}`).digest('hex');

  function cleanupSometimes(at: Date) {
    hits += 1;
    if (cleanupEvery <= 0 || hits % cleanupEvery !== 0) return;
    rateLimitsRepo.deleteExpired(config.identity.db, at).catch((error: unknown) => {
      config.log?.warn({ err: error }, 'rate limit cleanup failed');
    });
  }

  function windowOf(bucket: RateLimitBucket, key: string, at: Date) {
    const windowMs = RATE_LIMIT_BUCKETS[bucket].windowSeconds * 1000;
    const windowStart = new Date(Math.floor(at.getTime() / windowMs) * windowMs);
    const window: WindowKey = { bucket, keyHash: keyHash(bucket, key), windowStart };
    return { window, expiresAt: new Date(windowStart.getTime() + windowMs) };
  }

  function release(window: WindowKey, bucket: string) {
    return rateLimitsRepo.release(config.identity.db, window).catch((error: unknown) => {
      config.log?.warn({ err: error, bucket }, 'rate limit release failed');
    });
  }

  return {
    release: (bucket, key) => release(windowOf(bucket, key, now()).window, bucket),

    async consume(bucket, key) {
      const definition = RATE_LIMIT_BUCKETS[bucket];
      const at = now();
      const { window, expiresAt } = windowOf(bucket, key, at);

      let count: number;
      try {
        count = await rateLimitsRepo.hit(config.identity.db, window, expiresAt);
      } catch (error) {
        config.log?.error({ err: error, bucket }, 'rate limiter unavailable');
        if (definition.onError === 'closed') throw error;
        return NOOP_HIT;
      }
      cleanupSometimes(at);

      if (count > definition.limit) {
        const retryAfter = Math.max(1, Math.ceil((expiresAt.getTime() - at.getTime()) / 1000));
        throw new RateLimitError(retryAfter);
      }
      return { release: () => release(window, bucket) };
    },
  };
}
