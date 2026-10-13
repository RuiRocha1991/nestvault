import { getRateLimiter } from '@webapp/server/auth';

/**
 * `api` bucket (300 / min per session). Call it right after `requireSession` in every protected
 * Route Handler; it throws `RateLimitError`, which `route()` turns into 429 + `Retry-After`.
 */
export async function limitApiRequests(sessionId: string): Promise<void> {
  await (await getRateLimiter()).consume('api', sessionId);
}
