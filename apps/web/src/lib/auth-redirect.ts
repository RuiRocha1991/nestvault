import { safeNextPath } from '@nestvault/services';

import { SESSION_EXPIRED_REASON } from './session-reason';

/**
 * `/login`, carrying the page the user wanted when it is a safe same-origin path, and
 * `reason=expired` when a session cookie was sent but no longer works.
 */
export function loginUrl(
  requestedPath: string | null | undefined,
  options: { expired?: boolean } = {},
): string {
  const params = new URLSearchParams();
  const next = safeNextPath(requestedPath);
  if (next) params.set('next', next);
  if (options.expired) params.set('reason', SESSION_EXPIRED_REASON);
  const query = params.toString();
  return query ? `/login?${query}` : '/login';
}
