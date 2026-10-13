import { z } from 'zod';

import './zod-csp';

/** Sign-in form. The password length rule is the server's; the form never explains it. */
export const signInSchema = z
  .object({
    email: z.email().max(254),
    password: z.string().min(1).max(128),
  })
  .strict();

export type SignInResult =
  | { status: 'ok' }
  | { status: 'invalid' }
  | { status: 'rate_limited'; retryAfterSeconds: number }
  | { status: 'error' };

const DEFAULT_RETRY_AFTER_SECONDS = 60;
const MAX_RETRY_AFTER_SECONDS = 24 * 60 * 60;

/** `Retry-After` in seconds (the HTTP-date form is not used by this API). */
export function parseRetryAfter(value: string | null): number {
  const seconds = value !== null && /^\d{1,6}$/.test(value.trim()) ? Number(value) : NaN;
  if (!Number.isFinite(seconds) || seconds < 1) return DEFAULT_RETRY_AFTER_SECONDS;
  return Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
}

/** Maps the sign-in response to what the screen shows. Wrong email and wrong password look the same. */
export function interpretSignInResponse(status: number, retryAfter: string | null): SignInResult {
  if (status >= 200 && status < 300) return { status: 'ok' };
  if (status === 429) {
    return { status: 'rate_limited', retryAfterSeconds: parseRetryAfter(retryAfter) };
  }
  if (status === 400 || status === 401 || status === 403) return { status: 'invalid' };
  return { status: 'error' };
}

/** `m:ss` for the countdown. */
export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes)}:${String(safe % 60).padStart(2, '0')}`;
}
