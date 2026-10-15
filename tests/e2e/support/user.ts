import { resolve } from 'node:path';

/** The owner created by `global-setup.ts` in the `_test` identity database. Test data, not a secret. */
export const E2E_USER = {
  name: 'E2E Owner',
  email: 'owner@e2e.example.test',
  password: 'e2e-passphrase-for-tests-only',
} as const;

/** Cookies of a signed-in `E2E_USER`, saved once per run by `global-setup.ts`. */
export const STORAGE_STATE = resolve(import.meta.dirname, '../.auth/owner.json');

export const E2E_ORIGIN = 'http://127.0.0.1:4010';

/** A second server on the same build with `ALLOW_SIGNUP=true`, for the sign-up tests. */
export const E2E_OPEN_SIGNUP_ORIGIN = 'http://127.0.0.1:4011';

/**
 * The pool `global-setup.ts` creates for `E2E_USER` (a fixed UUID v7, so specs can name it). Users
 * made with `createUser` join it, so signing in lands on it, as it does for a one-pool user.
 */
export const E2E_POOL_ID = '019d0000-0000-7000-8000-00000000e2e0';

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Path of a page of the E2E pool (`poolPath('/contas')`). */
export const poolPath = (rest = '') => `/${E2E_POOL_ID}${rest}`;

/** Matches the URL of a page of the E2E pool, anchored at the end. */
export const poolUrl = (rest = '') => new RegExp(`${escape(poolPath(rest))}$`);

/** Matches the sign-in URL that remembers a page of the E2E pool as `next`. */
export const loginNextUrl = (rest = '') =>
  new RegExp(`/login\\?next=${escape(encodeURIComponent(poolPath(rest)))}$`);
