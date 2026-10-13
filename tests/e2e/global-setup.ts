import { request } from '@playwright/test';

import { testEnv } from '@nestvault/config/node';
import { createIdentityDatabase } from '@nestvault/db';
import { seedOwner } from '@nestvault/services';

import { prepareTestDatabases } from '../db/harness';

import { E2E_ORIGIN, E2E_USER, STORAGE_STATE } from './support/user';

/**
 * Resets the `_test` databases, creates the E2E owner and saves a signed-in session for the specs
 * that only need "a user who is signed in". The sign-in specs use their own browser context.
 * Needs `pnpm db:up` (the same Postgres as the integration tests).
 */
export default async function globalSetup(): Promise<void> {
  await prepareTestDatabases();
  const identity = createIdentityDatabase(testEnv().TEST_DATABASE_URL_IDENTITY, 1);
  try {
    await seedOwner(identity, E2E_USER);
  } finally {
    await identity.close();
  }

  const api = await request.newContext({ baseURL: E2E_ORIGIN });
  const response = await api.post('/api/v1/auth/sign-in/email', {
    headers: { Origin: E2E_ORIGIN },
    data: { email: E2E_USER.email, password: E2E_USER.password },
  });
  if (!response.ok())
    throw new Error(`E2E sign-in failed with status ${String(response.status())}`);
  await api.storageState({ path: STORAGE_STATE });
  await api.dispose();
}
