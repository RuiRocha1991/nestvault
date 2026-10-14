import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@nestvault/services';
import { z } from 'zod';

import { errorResponses, registry } from './registry';

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
const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/sign-up/email',
  operationId: 'signUpEmail',
  summary: 'Create an account',
  description:
    'Closed by default: returns 403 unless `ALLOW_SIGNUP=true` or the request carries a valid invite token for the same email in the `x-invite-token` header. A password found in a known breach returns 400 with code `PASSWORD_BREACHED`.',
  tags: ['Auth'],
  security: [],
  request: { body: { required: true, ...json(SignUpBody) } },
  responses: {
    200: {
      description: 'Account created and signed in',
      headers: setCookie,
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
    'Uses the token up. On success every session of the user is revoked and a "password changed" notice is emailed. A used, expired or unknown token answers 400. A password found in a known breach answers 400 with code `PASSWORD_BREACHED`. Limited like the request.',
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
    'Same neutral answer whether or not the address belongs to an unverified account. The link opens `/verificar/{token}` and is valid for 24 hours. Limited to 5 / 15 min per IP and per email, apart from the reset limit.',
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
