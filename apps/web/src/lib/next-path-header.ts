// Kept apart from `auth-redirect.ts`: `middleware.ts` runs in the Edge runtime and must not import
// `@nestvault/services` (argon2, node:crypto).

/** Request header set by `middleware.ts` with the path (and query) being requested. */
export const NEXT_PATH_HEADER = 'x-next-path';
