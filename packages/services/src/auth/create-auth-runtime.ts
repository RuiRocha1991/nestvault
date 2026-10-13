import { createIdentityDatabase } from '@nestvault/db';

import type { Logger } from '../logger';

import { createAuth, type Auth } from './create-auth';

export interface AuthRuntimeConfig {
  identityDatabaseUrl: string;
  appUrl: string;
  secret: string;
  allowSignup: boolean;
  log?: Logger;
}

/** Opens the identity connection (`identity_rw`) and builds the Better Auth instance on it. */
export function createAuthRuntime(config: AuthRuntimeConfig): Auth {
  const identity = createIdentityDatabase(config.identityDatabaseUrl);
  return createAuth({
    identity,
    appUrl: config.appUrl,
    secret: config.secret,
    allowSignup: config.allowSignup,
    ...(config.log ? { log: config.log } : {}),
  });
}
