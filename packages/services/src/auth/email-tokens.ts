import { isAPIError } from 'better-auth/api';

import type { Auth } from './create-auth';

// Reset tokens are `generateId(24)` from Better Auth: letters and digits only.
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

/** True when `token` is a reset token that exists and has not expired. Does not use it up. */
export async function isResetTokenValid(auth: Auth, token: string): Promise<boolean> {
  if (!TOKEN_SHAPE.test(token)) return false;
  const context = await auth.$context;
  const found = await context.internalAdapter.findVerificationValue(`reset-password:${token}`);
  return found ? found.expiresAt > new Date() : false;
}

/**
 * Marks the email of the token's user as verified. False for a bad, forged or expired token; any
 * other failure (database down, a bug) is thrown so it is logged and shown as an error, not as "link invalid".
 */
export async function verifyEmailWithToken(auth: Auth, token: string): Promise<boolean> {
  if (token.length > 2048) return false;
  try {
    await auth.api.verifyEmail({ query: { token } });
    return true;
  } catch (error) {
    if (isAPIError(error)) return false;
    throw error;
  }
}

export interface EmailStatus {
  email: string;
  emailVerified: boolean;
}

/**
 * The signed-in user's own address and whether it is verified, for the "confirm your email" screen.
 * Kept out of `AuthSession` so that the address does not travel with every session read.
 */
export async function getEmailStatus(auth: Auth, headers: Headers): Promise<EmailStatus | null> {
  const result = await auth.api.getSession({ headers });
  if (!result) return null;
  return { email: result.user.email, emailVerified: result.user.emailVerified };
}
