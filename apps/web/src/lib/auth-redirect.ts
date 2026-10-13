import { safeNextPath } from '@nestvault/services';

/** `/login`, carrying the page the user wanted when it is a safe same-origin path. */
export function loginUrl(requestedPath: string | null | undefined): string {
  const next = safeNextPath(requestedPath);
  return next ? `/login?next=${encodeURIComponent(next)}` : '/login';
}
