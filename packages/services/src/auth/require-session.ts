import { UnauthorizedError } from '../errors';

import type { Auth } from './create-auth';

export interface AuthSession {
  userId: string;
  sessionId: string;
  expiresAt: Date;
  /** Display name, for the shell. Never log it. */
  name: string;
}

/**
 * The caller's session, or `null` when there is none (no cookie, unknown, expired or revoked).
 * Pages use it to redirect to the sign-in screen; services and Route Handlers use `requireSession`.
 */
export async function getOptionalSession(
  auth: Auth,
  headers: Headers,
): Promise<AuthSession | null> {
  const result = await auth.api.getSession({ headers });
  if (!result) return null;
  return {
    userId: result.user.id,
    sessionId: result.session.id,
    expiresAt: result.session.expiresAt,
    name: result.user.name,
  };
}

/**
 * Guard 1 of the chain (session → validation → pool → permission). Returns the caller's session or
 * throws `UnauthorizedError`. Call it in every service and Route Handler; `middleware.ts` is never
 * the only check.
 */
export async function requireSession(auth: Auth, headers: Headers): Promise<AuthSession> {
  const session = await getOptionalSession(auth, headers);
  if (!session) throw new UnauthorizedError();
  return session;
}
