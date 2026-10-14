/** What happens when the counter cannot be read or written (database down). */
export type OnLimiterError = 'closed' | 'open';

export interface BucketDefinition {
  readonly limit: number;
  readonly windowSeconds: number;
  /** `closed`: reject (auth, where a free pass means unlimited password guesses). `open`: let it through and log. */
  readonly onError: OnLimiterError;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Security control 11. Keys: IP / email for auth, session id for `api`, pool id for the rest. */
export const RATE_LIMIT_BUCKETS = {
  'auth.signin.ip': { limit: 5, windowSeconds: 15 * MINUTE, onError: 'closed' },
  'auth.signin.email': { limit: 5, windowSeconds: 15 * MINUTE, onError: 'closed' },
  // Used instead of the two `.ip` buckets while the client address is unknown (no trusted proxy):
  // one shared key, so the limit is loose and 5 failures of one person never lock out everybody.
  // Per-account guessing is still held to 5 by the `.email` buckets.
  'auth.signin.untrusted': { limit: 50, windowSeconds: 15 * MINUTE, onError: 'closed' },
  'auth.verify.ip': { limit: 5, windowSeconds: 15 * MINUTE, onError: 'closed' },
  'auth.verify.email': { limit: 5, windowSeconds: 15 * MINUTE, onError: 'closed' },
  'auth.verify.untrusted': { limit: 50, windowSeconds: 15 * MINUTE, onError: 'closed' },
  'auth.reset.untrusted': { limit: 50, windowSeconds: 15 * MINUTE, onError: 'closed' },
  'auth.reset.ip': { limit: 5, windowSeconds: 15 * MINUTE, onError: 'closed' },
  'auth.reset.email': { limit: 5, windowSeconds: 15 * MINUTE, onError: 'closed' },
  // Creating accounts (only reachable when sign-up is open or with an invite).
  'auth.signup.ip': { limit: 5, windowSeconds: 15 * MINUTE, onError: 'closed' },
  'auth.signup.email': { limit: 5, windowSeconds: 15 * MINUTE, onError: 'closed' },
  'auth.signup.untrusted': { limit: 50, windowSeconds: 15 * MINUTE, onError: 'closed' },
  // Changing the password or the email of a signed-in account (wrong current password counts).
  'auth.account.ip': { limit: 5, windowSeconds: 15 * MINUTE, onError: 'closed' },
  'auth.account.user': { limit: 5, windowSeconds: 15 * MINUTE, onError: 'closed' },
  'auth.account.untrusted': { limit: 50, windowSeconds: 15 * MINUTE, onError: 'closed' },
  api: { limit: 300, windowSeconds: MINUTE, onError: 'open' },
  imports: { limit: 20, windowSeconds: HOUR, onError: 'open' },
  invites: { limit: 20, windowSeconds: DAY, onError: 'open' },
} as const satisfies Record<string, BucketDefinition>;

export type RateLimitBucket = keyof typeof RATE_LIMIT_BUCKETS;
