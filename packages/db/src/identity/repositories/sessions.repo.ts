import { and, desc, eq, gt, ne } from 'drizzle-orm';

import type { IdentityDatabase } from '../client';
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
};
