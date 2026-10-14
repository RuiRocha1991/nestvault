import { newId, usersRepo, type IdentityDatabase } from '@nestvault/db';
import { account, session, user, verification } from '@nestvault/db/identity-schema';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import {
  APIError,
  createAuthMiddleware,
  createEmailVerificationToken,
  getSessionFromCtx,
  isAPIError,
} from 'better-auth/api';

import type { EmailSender } from '../email';
import {
  existingAccountTemplate,
  passwordChangedTemplate,
  resetPasswordTemplate,
  verifyEmailTemplate,
} from '../email';
import { RateLimitError } from '../errors';
import type { Logger } from '../logger';
import {
  createRateLimiter,
  getClientIp,
  UNTRUSTED_CLIENT_KEY,
  type RateLimitBucket,
  type RateLimiter,
} from '../rate-limit';

import { isPasswordBreached } from './breached-passwords';
import { withHashedSessionTokens } from './hashed-session-adapter';
import { firstFailedPasswordRule } from './password-policy';
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
  /** Sends the verification, reset and "password changed" emails. */
  email?: EmailSender;
  /** Shared with the API routes; built from `identity` and `secret` when omitted. */
  limiter?: RateLimiter;
  /** Proxies we run in front of the app (0 = none: `x-forwarded-for` is ignored). */
  trustedProxyHops?: number;
  /** Tests replace the HIBP lookup. */
  checkBreached?: (password: string) => Promise<boolean>;
}

/** Paths whose body carries a new password to screen, and the field that holds it. */
const SIGN_IN_PATH = '/sign-in/email';
const SIGN_UP_PATH = '/sign-up/email';
/** Password reset: request the email and use the token. Every call counts. */
const RESET_PATHS: ReadonlySet<string> = new Set(['/request-password-reset', '/reset-password']);
/** Resending the verification email has its own limit, so it never uses up a password reset. */
const VERIFY_PATH = '/send-verification-email';

/** Account changes of a signed-in user: the current password is guessable here, so every call counts. */
const ACCOUNT_PATHS: ReadonlySet<string> = new Set(['/change-password', '/change-email']);

type LimitScope = 'signin' | 'signup' | 'reset' | 'verify' | 'account';
const SCOPE_BY_PATH = new Map<string, LimitScope>([
  [SIGN_IN_PATH, 'signin'],
  [SIGN_UP_PATH, 'signup'],
  [VERIFY_PATH, 'verify'],
  ...[...RESET_PATHS].map((path): [string, LimitScope] => [path, 'reset']),
  ...[...ACCOUNT_PATHS].map((path): [string, LimitScope] => [path, 'account']),
]);
const scopeOf = (path: string): LimitScope | null => SCOPE_BY_PATH.get(path) ?? null;

export const RESET_TOKEN_EXPIRES_IN_SECONDS = 60 * 60;
export const VERIFY_EMAIL_EXPIRES_IN_SECONDS = 24 * 60 * 60;
/** Where the links of the emails land (pages of the web app, not the API). */
export const RESET_PAGE_PATH = '/recuperar';
export const VERIFY_PAGE_PATH = '/verificar';

/** Used when no sender is wired: the message is dropped (never printed: it carries a token). */
const NO_EMAIL: EmailSender = { send: () => Promise.resolve() };

function tooManyRequests(error: RateLimitError): APIError {
  return new APIError(
    'TOO_MANY_REQUESTS',
    { code: error.code, message: error.message },
    { 'Retry-After': String(error.retryAfterSeconds) },
  );
}

/** The per-IP bucket, or the loose shared one while the address is unknown. */
function ipBucket(scope: LimitScope, ip: string): RateLimitBucket {
  return ip === UNTRUSTED_CLIENT_KEY ? `auth.${scope}.untrusted` : `auth.${scope}.ip`;
}

/** The per-subject bucket: the account bucket is keyed by user id, the others by email. */
function subjectBucket(scope: LimitScope): RateLimitBucket {
  return scope === 'account' ? 'auth.account.user' : `auth.${scope}.email`;
}

function emailOf(body: unknown): string | null {
  const email = (body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' && email.length > 0 && email.length <= 254 ? email : null;
}

const PASSWORD_FIELDS: Readonly<Record<string, string>> = {
  '/sign-up/email': 'password',
  '/change-password': 'newPassword',
  '/reset-password': 'newPassword',
};

const RESET_TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * The address of the account whose password is being set, for the rules that depend on it:
 * the body on sign-up, the signed-in user on change-password, the token's user on reset. Undefined
 * when it cannot be told (a bad token), so that rule is skipped; Better Auth rejects the call.
 */
async function accountEmailOf(ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]) {
  if (ctx.path === SIGN_UP_PATH) return emailOf(ctx.body) ?? undefined;
  if (ctx.path === '/change-password') return (await getSessionFromCtx(ctx))?.user.email;
  const token = (ctx.body as { token?: unknown } | undefined)?.token;
  if (
    ctx.path !== '/reset-password' ||
    typeof token !== 'string' ||
    !RESET_TOKEN_SHAPE.test(token)
  ) {
    return undefined;
  }
  const found = await ctx.context.internalAdapter.findVerificationValue(`reset-password:${token}`);
  if (!found || found.expiresAt <= new Date()) return undefined;
  return (await ctx.context.internalAdapter.findUserById(found.value))?.email;
}

/** The Better Auth instance: email + password, argon2id, database sessions, closed sign-up. */
export function createAuth(config: AuthConfig) {
  const invites = config.invites ?? NO_INVITES;
  const checkBreached =
    config.checkBreached ??
    ((password) => isPasswordBreached(password, config.log ? { log: config.log } : {}));
  const limiter =
    config.limiter ??
    createRateLimiter({
      identity: config.identity,
      secret: config.secret,
      ...(config.log ? { log: config.log } : {}),
    });
  const email = config.email ?? NO_EMAIL;
  /**
   * Sends without waiting, so the answer takes the same time whether or not the account exists
   * (no enumeration by timing). A failure is logged by the sender and never reaches the client.
   */
  const sendInBackground = (message: Parameters<EmailSender['send']>[0]) => {
    // The sender logs its own failure; this only keeps it from becoming an unhandled rejection.
    email.send(message).catch(() => undefined);
  };
  const link = (path: string, token: string) =>
    `${config.appUrl}${path}/${encodeURIComponent(token)}`;
  const proxyHops = config.trustedProxyHops ?? 0;
  const clientIpOf = (headers: Headers | undefined) =>
    getClientIp(headers ?? new Headers(), proxyHops);
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
      // No session exists for an address nobody has confirmed, so the app cannot be used before
      // verifying. A sign-up for an address that already has an account answers like a new one.
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      onExistingUserSignUp: async ({ user: target }) => {
        // Still unverified: the person probably lost the first link, so send a new one instead of
        // "you already have an account" (which they cannot use yet).
        if (!target.emailVerified) {
          const token = await createEmailVerificationToken(
            config.secret,
            target.email,
            undefined,
            VERIFY_EMAIL_EXPIRES_IN_SECONDS,
          );
          sendInBackground({
            to: target.email,
            ...verifyEmailTemplate({ name: target.name, url: link(VERIFY_PAGE_PATH, token) }),
          });
          return;
        }
        sendInBackground({
          to: target.email,
          ...existingAccountTemplate({
            name: target.name,
            loginUrl: `${config.appUrl}/login`,
            resetUrl: `${config.appUrl}${RESET_PAGE_PATH}`,
          }),
        });
      },
      resetPasswordTokenExpiresIn: RESET_TOKEN_EXPIRES_IN_SECONDS,
      sendResetPassword: ({ user: target, token }) => {
        sendInBackground({
          to: target.email,
          ...resetPasswordTemplate({ name: target.name, url: link(RESET_PAGE_PATH, token) }),
        });
        return Promise.resolve();
      },
      onPasswordReset: async ({ user: target }) => {
        sendInBackground({ to: target.email, ...passwordChangedTemplate({ name: target.name }) });
        // The link came by email, so the person has read this mailbox. The password is already
        // changed: a failure here must not turn the reset into an error.
        await usersRepo.markEmailVerified(config.identity.db, target.id).catch(() => undefined);
      },
    },
    emailVerification: {
      expiresIn: VERIFY_EMAIL_EXPIRES_IN_SECONDS,
      sendOnSignUp: true,
      sendOnSignIn: true,
      sendVerificationEmail: ({ user: target, token }) => {
        sendInBackground({
          to: target.email,
          ...verifyEmailTemplate({ name: target.name, url: link(VERIFY_PAGE_PATH, token) }),
        });
        return Promise.resolve();
      },
    },
    // The new address gets a verification link (our template); the email only changes once it is
    // used. An address that is already taken answers the same, so nothing is revealed.
    user: { changeEmail: { enabled: true } },
    // Reset tokens are stored as a hash: a database leak does not give working links.
    verification: { storeIdentifier: 'hashed' },
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
    rateLimit: { enabled: false }, // replaced by the Postgres-backed limiter below (control 11)
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // A sign-up that the closed instance refuses from the config alone (no invite to look up)
        // costs nothing, so it does not write to the limiter either.
        const refusedForFree =
          ctx.path === SIGN_UP_PATH &&
          !config.allowSignup &&
          !ctx.headers?.get(INVITE_TOKEN_HEADER);
        const scope = refusedForFree ? null : scopeOf(ctx.path);
        if (scope) {
          const ip = clientIpOf(ctx.headers);
          // Account changes are limited per signed-in user; the others per email in the body.
          const subject =
            scope === 'account'
              ? ((await getSessionFromCtx(ctx))?.user.id ?? null)
              : emailOf(ctx.body);
          try {
            // The hit is counted now and handed back after a successful sign-in, so only failed
            // attempts stay counted and parallel requests cannot all pass a later check.
            await limiter.consume(ipBucket(scope, ip), ip);
            if (subject) await limiter.consume(subjectBucket(scope), subject);
          } catch (error) {
            if (error instanceof RateLimitError) throw tooManyRequests(error);
            throw error;
          }
        }
        if (ctx.path === '/sign-up/email') {
          const body = ctx.body as { email?: unknown } | undefined;
          const allowed = await isSignupAllowed({
            allowSignup: config.allowSignup,
            email: typeof body?.email === 'string' ? body.email : '',
            inviteToken: ctx.headers?.get(INVITE_TOKEN_HEADER),
            invites,
          });
          if (!allowed) {
            throw new APIError('FORBIDDEN', {
              code: 'signup_closed',
              message: 'Sign-up is closed.',
            });
          }
        }
        const field = PASSWORD_FIELDS[ctx.path];
        const password = field ? (ctx.body as Record<string, unknown> | undefined)?.[field] : null;
        if (typeof password === 'string') {
          const failed = firstFailedPasswordRule(password, { email: await accountEmailOf(ctx) });
          if (failed)
            throw new APIError('BAD_REQUEST', { code: failed.code, message: failed.message });
          if (await checkBreached(password)) {
            throw new APIError('BAD_REQUEST', {
              code: 'PASSWORD_BREACHED',
              message: 'This password appeared in a data breach. Choose another one.',
            });
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (isAPIError(ctx.context.returned)) return;
        if (ctx.path === '/change-password') {
          const target = (ctx.context.returned as { user?: { email?: string; name?: string } })
            .user;
          if (target?.email) {
            sendInBackground({
              to: target.email,
              ...passwordChangedTemplate({ name: target.name ?? '' }),
            });
          }
          return;
        }
        if (ctx.path !== SIGN_IN_PATH) return;
        const email = emailOf(ctx.body);
        const ip = clientIpOf(ctx.headers);
        await limiter.release(ipBucket('signin', ip), ip);
        if (email) await limiter.release('auth.signin.email', email);
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
