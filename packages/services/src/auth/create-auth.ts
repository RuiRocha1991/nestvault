import { newId, type IdentityDatabase } from '@nestvault/db';
import { account, session, user, verification } from '@nestvault/db/identity-schema';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';

import type { Logger } from '../logger';

import { isPasswordBreached } from './breached-passwords';
import { withHashedSessionTokens } from './hashed-session-adapter';
import {
  hashPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  verifyPassword,
} from './passwords';
import {
  INVITE_TOKEN_HEADER,
  isSignupAllowed,
  NO_INVITES,
  type InviteVerifier,
} from './signup-policy';

export const AUTH_BASE_PATH = '/api/v1/auth';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

export interface AuthConfig {
  identity: IdentityDatabase;
  /** Origin of the app, e.g. `http://localhost:4000`. Also the only trusted origin. */
  appUrl: string;
  secret: string;
  allowSignup: boolean;
  invites?: InviteVerifier;
  log?: Logger;
  /** Tests replace the HIBP lookup. */
  checkBreached?: (password: string) => Promise<boolean>;
}

/** Paths whose body carries a new password to screen, and the field that holds it. */
const PASSWORD_FIELDS: Readonly<Record<string, string>> = {
  '/sign-up/email': 'password',
  '/change-password': 'newPassword',
  '/reset-password': 'newPassword',
};

/** The Better Auth instance: email + password, argon2id, database sessions, closed sign-up. */
export function createAuth(config: AuthConfig) {
  const invites = config.invites ?? NO_INVITES;
  const checkBreached =
    config.checkBreached ??
    ((password) => isPasswordBreached(password, config.log ? { log: config.log } : {}));
  const secureCookies = new URL(config.appUrl).protocol === 'https:';

  return betterAuth({
    appName: 'NestVault',
    baseURL: config.appUrl,
    basePath: AUTH_BASE_PATH,
    secret: config.secret,
    trustedOrigins: [config.appUrl],
    database: withHashedSessionTokens(
      drizzleAdapter(config.identity.db, {
        provider: 'pg',
        schema: { user, session, account, verification },
      }),
    ),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      password: { hash: hashPassword, verify: verifyPassword },
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      expiresIn: SESSION_MAX_AGE_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      // No cookie cache: every request reads the database, so a revoked session dies immediately.
      cookieCache: { enabled: false },
    },
    advanced: {
      cookiePrefix: 'nv',
      useSecureCookies: secureCookies,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
      database: { generateId: () => newId() },
    },
    rateLimit: { enabled: false }, // replaced by the Postgres-backed limiter in NES-23
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-up/email') {
          const body = ctx.body as { email?: unknown } | undefined;
          const allowed = await isSignupAllowed({
            allowSignup: config.allowSignup,
            email: typeof body?.email === 'string' ? body.email : '',
            inviteToken: ctx.headers?.get(INVITE_TOKEN_HEADER),
            invites,
          });
          if (!allowed) throw new APIError('FORBIDDEN', { message: 'Sign-up is closed.' });
        }
        const field = PASSWORD_FIELDS[ctx.path];
        const password = field ? (ctx.body as Record<string, unknown> | undefined)?.[field] : null;
        if (typeof password === 'string' && (await checkBreached(password))) {
          throw new APIError('BAD_REQUEST', {
            code: 'PASSWORD_BREACHED',
            message: 'This password appeared in a data breach. Choose another one.',
          });
        }
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
