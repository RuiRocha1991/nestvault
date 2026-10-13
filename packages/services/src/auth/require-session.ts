import { UnauthorizedError } from '../errors';

import type { Auth } from './create-auth';

export interface AuthSession {
  userId: string;
  sessionId: string;
  expiresAt: Date;
}

/**
 * Guard 1 of the chain (session → validation → pool → permission). Returns the caller's session or
 * throws `UnauthorizedError`. Call it in every service and Route Handler; `middleware.ts` is never
 * the only check.
 */
export async function requireSession(auth: Auth, headers: Headers): Promise<AuthSession> {
  const result = await auth.api.getSession({ headers });
  if (!result) throw new UnauthorizedError();
  return {
    userId: result.user.id,
    sessionId: result.session.id,
    expiresAt: result.session.expiresAt,
  };
}
