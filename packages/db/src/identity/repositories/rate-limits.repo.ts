import { and, eq, lt, sql } from 'drizzle-orm';

import type { IdentityDatabase } from '../client';
import { rateLimits } from '../schema';

export interface WindowKey {
  bucket: string;
  /** HMAC of the limited subject (never the raw IP, email or session id). */
  keyHash: string;
  windowStart: Date;
}

/** Counters of the rate limiter. Identity data: no pool context. */
export const rateLimitsRepo = {
  /**
   * Adds one hit to the window and returns the new count. One atomic statement, so parallel
   * requests each get a distinct count and cannot slip past the limit together.
   */
  async hit(db: IdentityDatabase['db'], key: WindowKey, expiresAt: Date): Promise<number> {
    const [row] = await db
      .insert(rateLimits)
      .values({ ...key, count: 1, expiresAt })
      .onConflictDoUpdate({
        target: [rateLimits.bucket, rateLimits.keyHash, rateLimits.windowStart],
        set: { count: sql`${rateLimits.count} + 1` },
      })
      .returning({ count: rateLimits.count });
    if (!row) throw new Error('rate limit upsert returned no row');
    return row.count;
  },

  /** Gives one hit back (a successful sign-in is not a failed attempt). Never goes below zero. */
  async release(db: IdentityDatabase['db'], key: WindowKey): Promise<void> {
    await db
      .update(rateLimits)
      .set({ count: sql`greatest(${rateLimits.count} - 1, 0)` })
      .where(
        and(
          eq(rateLimits.bucket, key.bucket),
          eq(rateLimits.keyHash, key.keyHash),
          eq(rateLimits.windowStart, key.windowStart),
        ),
      );
  },

  /** Deletes windows that have ended. Returns how many rows went. */
  async deleteExpired(db: IdentityDatabase['db'], now: Date): Promise<number> {
    const rows = await db
      .delete(rateLimits)
      .where(lt(rateLimits.expiresAt, now))
      .returning({ bucket: rateLimits.bucket });
    return rows.length;
  },
};
