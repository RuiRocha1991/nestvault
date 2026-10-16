import { and, desc, eq, gt, isNull, ne, or } from 'drizzle-orm';

import type { IdentityDatabase, IdentityExecutor } from '../client';
import { session } from '../schema';

/** A session as the account page needs it. The token (hash) is never selected. */
export interface SessionRow {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

/**
 * Every function takes the owner's `userId` and filters by it, so a session id of somebody else
 * matches nothing (the caller answers 404). Ids are bound parameters.
 */
export const sessionsRepo = {
  /** The user's sessions that have not expired, most recently active first. */
  async listActive(db: IdentityDatabase['db'], userId: string, now = new Date()) {
    return db
      .select({
        id: session.id,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        expiresAt: session.expiresAt,
      })
      .from(session)
      .where(and(eq(session.userId, userId), gt(session.expiresAt, now)))
      .orderBy(desc(session.updatedAt));
  },

  /**
   * Remembers the pool the session is working in. Only touches the user's own session, and only
   * writes when the value changes, so switching nothing costs no update.
   */
  async setActivePool(
    db: IdentityDatabase['db'],
    userId: string,
    sessionId: string,
    poolId: string,
  ): Promise<void> {
    await db
      .update(session)
      .set({ activePoolId: poolId })
      .where(
        and(
          eq(session.id, sessionId),
          eq(session.userId, userId),
          or(isNull(session.activePoolId), ne(session.activePoolId, poolId)),
        ),
      );
  },

  /** The pool the session last worked in, or `null`. Only reads the user's own session. */
  async activePool(
    db: IdentityDatabase['db'],
    userId: string,
    sessionId: string,
  ): Promise<string | null> {
    const [row] = await db
      .select({ activePoolId: session.activePoolId })
      .from(session)
      .where(and(eq(session.id, sessionId), eq(session.userId, userId)))
      .limit(1);
    return row?.activePoolId ?? null;
  },

  /** Deletes one session of the user. `false` when it does not exist or belongs to someone else. */
  async deleteOwned(db: IdentityDatabase['db'], userId: string, sessionId: string) {
    const deleted = await db
      .delete(session)
      .where(and(eq(session.id, sessionId), eq(session.userId, userId)))
      .returning({ id: session.id });
    return deleted.length > 0;
  },

  /** Deletes every session of the user except `keepSessionId`. Returns how many ended. */
  async deleteOthers(db: IdentityDatabase['db'], userId: string, keepSessionId: string) {
    const deleted = await db
      .delete(session)
      .where(and(eq(session.userId, userId), ne(session.id, keepSessionId)))
      .returning({ id: session.id });
    return deleted.length;
  },

  /**
   * Ends every session of the user that was working in the pool, so the person signs in again with
   * the permissions they have now. Sessions that last worked in another pool stay. Returns how
   * many ended.
   */
  async endInPool(db: IdentityExecutor, userId: string, poolId: string): Promise<number> {
    const ended = await db
      .delete(session)
      .where(and(eq(session.userId, userId), eq(session.activePoolId, poolId)))
      .returning({ id: session.id });
    return ended.length;
  },

  /** Forgets the pool as the active one of the user's sessions (the user left it). */
  async clearActivePool(db: IdentityExecutor, userId: string, poolId: string): Promise<void> {
    await db
      .update(session)
      .set({ activePoolId: null })
      .where(and(eq(session.userId, userId), eq(session.activePoolId, poolId)));
  },
};
