import { createIdentityDatabase } from '@nestvault/db';

import type { EmailSender } from '../email';
import type { Logger } from '../logger';
import { createRateLimiter, type RateLimiter } from '../rate-limit';

import { createAuth, type Auth } from './create-auth';

export interface AuthRuntimeConfig {
  identityDatabaseUrl: string;
  appUrl: string;
  secret: string;
  allowSignup: boolean;
  trustedProxyHops?: number;
  email: EmailSender;
  log?: Logger;
}

export interface AuthRuntime {
  auth: Auth;
  /** Same identity connection as `auth`: sessions, users and rate-limit counters share one pool. */
  limiter: RateLimiter;
}

/** Opens the identity connection (`identity_rw`) and builds Better Auth and the rate limiter on it. */
export function createAuthRuntime(config: AuthRuntimeConfig): AuthRuntime {
  const identity = createIdentityDatabase(config.identityDatabaseUrl);
  const limiter = createRateLimiter({
    identity,
    secret: config.secret,
    ...(config.log ? { log: config.log } : {}),
  });
  const auth = createAuth({
    identity,
    appUrl: config.appUrl,
    secret: config.secret,
    allowSignup: config.allowSignup,
    limiter,
    email: config.email,
    ...(config.trustedProxyHops !== undefined ? { trustedProxyHops: config.trustedProxyHops } : {}),
    ...(config.log ? { log: config.log } : {}),
  });
  return { auth, limiter };
}
