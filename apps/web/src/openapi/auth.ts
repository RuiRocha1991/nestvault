import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, json, registry } from './registry';

// Documentation of the Better Auth endpoints mounted at /api/v1/auth/[...all]. Better Auth owns the
// validation; these schemas describe the contract. Passwords are 12-128 characters, screened
// against the HIBP breach list, and stored as argon2id.

const email = z.email().openapi({ example: 'ana@example.com' });
const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH)
  .openapi({ example: 'a-long-unique-passphrase' });

const AuthUser = registry.register(
  'AuthUser',
  z.object({
    id: z.uuid(),
    name: z.string(),
    email,
    emailVerified: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);

const SignUpBody = registry.register(
  'SignUpBody',
  z.object({ name: z.string().min(1).max(120), email, password }).strict(),
);
const SignInBody = registry.register('SignInBody', z.object({ email, password }).strict());
const ChangePasswordBody = registry.register(
  'ChangePasswordBody',
  z
    .object({
      currentPassword: z.string(),
      newPassword: password,
      revokeOtherSessions: z.boolean().optional(),
    })
    .strict(),
);
const AuthUserResponse = registry.register(
  'AuthUserResponse',
  z.object({ token: z.string().nullable(), user: AuthUser }),
);
const SessionResponse = registry.register(
  'SessionResponse',
  z
    .object({
      session: z.object({ id: z.uuid(), expiresAt: z.iso.datetime() }),
      user: AuthUser,
    })
    .nullable(),
);

const setCookie = {
  'Set-Cookie': {
    description:
      'Session cookie `nv.session_token`: HttpOnly, SameSite=Lax, Path=/, Max-Age 30 days (sliding, renewed daily).',
    schema: { type: 'string' as const },
  },
};

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/sign-up/email',
  operationId: 'signUpEmail',
  summary: 'Create an account',
  description:
    'Closed by default: returns 403 with code `signup_closed` unless `ALLOW_SIGNUP=true` or the request carries a valid invite token for the same email in the `x-invite-token` header. The account starts unverified and no session is created (`token` is null): a verification link is emailed and sign-in answers 403 `EMAIL_NOT_VERIFIED` until it is used. An email that already has an account answers exactly like a new one (and the owner is told by email), so nothing reveals which accounts exist. Passwords: at least 12 characters (`PASSWORD_TOO_SHORT`), not a common one (`PASSWORD_TOO_COMMON`), not based on the email (`PASSWORD_BASED_ON_EMAIL`) and not in a known breach (`PASSWORD_BREACHED`), all 400. Limited to 5 / 15 min per IP and per email (429 with `Retry-After`).',
  tags: ['Auth'],
  security: [],
  request: { body: { required: true, ...json(SignUpBody) } },
  responses: {
    200: {
      description: 'Account created (or the same answer for an existing email); no session yet',
      ...json(AuthUserResponse),
    },
    ...errorResponses(400, 403, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/sign-in/email',
  operationId: 'signInEmail',
  summary: 'Sign in with email and password',
  description:
    'An account whose email is not confirmed answers 403 with code `EMAIL_NOT_VERIFIED` (after the right password) and a new verification link is sent.',
  tags: ['Auth'],
  security: [],
  request: { body: { required: true, ...json(SignInBody) } },
  responses: {
    200: { description: 'Signed in', headers: setCookie, ...json(AuthUserResponse) },
    ...errorResponses(400, 401, 403, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/sign-out',
  operationId: 'signOut',
  summary: 'End the current session',
  tags: ['Auth'],
  responses: {
    200: {
      description: 'Session deleted and cookie cleared',
      ...json(z.object({ success: z.boolean() })),
    },
    ...errorResponses(401, 403, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/auth/get-session',
  operationId: 'getSession',
  summary: 'The current session',
  description: 'Returns `null` when there is no valid session cookie.',
  tags: ['Auth'],
  security: [],
  responses: {
    200: { description: 'The session and its user, or null', ...json(SessionResponse) },
    ...errorResponses(500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/change-password',
  operationId: 'changePassword',
  summary: 'Change the password of the signed-in user',
  description:
    'A wrong current password answers 400. The new password follows the same rules as sign-up, all 400: `PASSWORD_TOO_SHORT`, `PASSWORD_TOO_COMMON`, `PASSWORD_BASED_ON_EMAIL` (contains the email of the account) and `PASSWORD_BREACHED`. Limited to 5 / 15 min per user (wrong attempts count). Send `revokeOtherSessions: true` to end every other session; the response then sets a new cookie for this browser. A "password changed" notice is emailed.',
  tags: ['Auth'],
  request: { body: { required: true, ...json(ChangePasswordBody) } },
  responses: {
    200: { description: 'Password changed', ...json(AuthUserResponse) },
    ...errorResponses(400, 401, 403, 429, 500),
  },
});

const StatusResponse = registry.register(
  'StatusResponse',
  z.object({ status: z.boolean(), message: z.string().optional() }),
);

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/request-password-reset',
  operationId: 'requestPasswordReset',
  summary: 'Ask for a password reset link by email',
  description:
    'Always answers 200 with the same body, whether or not the account exists (no account enumeration); the email is sent in the background. The link opens `/recuperar/{token}`: single use, valid for 1 hour, the token is stored hashed. Limited to 5 requests / 15 min per IP and per email (429 with `Retry-After`).',
  tags: ['Auth'],
  security: [],
  request: { body: { required: true, ...json(z.object({ email }).strict()) } },
  responses: {
    200: { description: 'Neutral confirmation', ...json(StatusResponse) },
    ...errorResponses(400, 403, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/reset-password',
  operationId: 'resetPassword',
  summary: 'Set a new password with the token of the emailed link',
  description:
    'Uses the token up. On success every session of the user is revoked and a "password changed" notice is emailed. A used, expired or unknown token answers 400. The new password follows the same rules as sign-up, all 400: `PASSWORD_TOO_SHORT`, `PASSWORD_TOO_COMMON`, `PASSWORD_BASED_ON_EMAIL` (contains the email of the token owner) and `PASSWORD_BREACHED`; a rejected password does not use the token up. Limited like the request.',
  tags: ['Auth'],
  security: [],
  request: {
    body: {
      required: true,
      ...json(z.object({ token: z.string().min(16).max(128), newPassword: password }).strict()),
    },
  },
  responses: {
    200: { description: 'Password changed, all sessions ended', ...json(StatusResponse) },
    ...errorResponses(400, 403, 429, 500),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/send-verification-email',
  operationId: 'sendVerificationEmail',
  summary: 'Send (or resend) the email verification link',
  description:
    'Same neutral answer whether or not the address belongs to an unverified account. The link opens `/verificar/{token}` and is valid for 24 hours. Limited to 5 / 15 min per IP and per email, apart from the reset limit. The email itself is sent at most once a minute and ten times an hour per address (shared with sign-up and sign-in); over that the answer is the same but nothing is sent.',
  tags: ['Auth'],
  security: [],
  request: { body: { required: true, ...json(z.object({ email }).strict()) } },
  responses: {
    200: { description: 'Neutral confirmation', ...json(StatusResponse) },
    ...errorResponses(400, 403, 429, 500),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/auth/verify-email',
  operationId: 'verifyEmail',
  summary: 'Mark the email of the token as verified',
  description: 'Used by the `/verificar/{token}` page. A bad, forged or expired token answers 401.',
  tags: ['Auth'],
  security: [],
  request: { query: z.object({ token: z.string().max(2048) }) },
  responses: {
    200: { description: 'Email verified', ...json(StatusResponse) },
    ...errorResponses(401, 500),
  },
});
