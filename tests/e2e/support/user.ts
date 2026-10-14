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
