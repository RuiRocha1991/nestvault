import { createIdentityDatabase } from '@nestvault/db';

import { createAccountService, type AccountService } from '../account';
import { createAuditService, type AuditService } from '../audit';
import type { EmailSender } from '../email';
import { createHoldersService, type HoldersService } from '../holders';
import { createInvitesService, createInviteVerifier, type InvitesService } from '../invites';
import type { Logger } from '../logger';
import { createMembersService, type MembersService } from '../members';
import { createPoolsService, type PoolsService } from '../pools';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import { createSettingsService, type SettingsService } from '../settings';

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
  /** Profile and sessions of the signed-in user. */
  account: AccountService;
  /** Create, list and open the pools of the signed-in user. */
  pools: PoolsService;
  /** Invite members by email and accept invites. */
  invites: InvitesService;
  /** Roles, removal, leaving and ownership transfer of a pool's members. */
  members: MembersService;
  /** The pool's audit log for its owner. */
  audit: AuditService;
  /** The people of the household (owners of accounts). */
  holders: HoldersService;
  /** Pool settings and the FX rates the pool uses. */
  settings: SettingsService;
}

/** Opens the identity connection (`identity_rw`) and builds Better Auth and the rate limiter on it. */
export function createAuthRuntime(config: AuthRuntimeConfig): AuthRuntime {
  const identity = createIdentityDatabase(config.identityDatabaseUrl);
  const hops =
    config.trustedProxyHops !== undefined ? { trustedProxyHops: config.trustedProxyHops } : {};
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
    invites: createInviteVerifier(identity),
    ...hops,
    ...(config.log ? { log: config.log } : {}),
  });
  const pools = createPoolsService({ auth, identity, ...hops });
  return {
    auth,
    limiter,
    account: createAccountService({ auth, identity, pools, ...hops }),
    pools,
    invites: createInvitesService({
      auth,
      identity,
      limiter,
      email: config.email,
      appUrl: config.appUrl,
      ...hops,
    }),
    members: createMembersService({ auth, identity, limiter, ...hops }),
    audit: createAuditService({ auth, identity }),
    holders: createHoldersService({ auth, identity, ...hops }),
    settings: createSettingsService({ auth, identity, ...hops }),
  };
}
