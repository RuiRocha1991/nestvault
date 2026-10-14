import { requireSession, type AuthSession } from '@nestvault/services';

import { getAuth } from '@webapp/server/auth';

import { limitApiRequests } from './rate-limit';
import type { RouteContext } from './route';

/**
 * Guard 1 for Route Handlers of the signed-in user: the session (401), the actor in the log lines
 * and the `api` rate limit (429).
 */
export async function signedIn(
  req: Request,
  ctx: Pick<RouteContext<unknown>, 'setActor'>,
): Promise<AuthSession> {
  const session = await requireSession(await getAuth(), req.headers);
  ctx.setActor({ userId: session.userId });
  await limitApiRequests(session.sessionId);
  return session;
}
