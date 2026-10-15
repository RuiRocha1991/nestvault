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

/**
 * The three buckets of one auth scope: per client IP, per subject (`email`, or `user` for a signed-in
 * account) and the loose shared one used while the IP is unknown (no trusted proxy). 5 failures in
 * 15 minutes; the shared bucket allows 50 so one person's failures never lock out everybody.
 */
function authScope<Scope extends string, Subject extends string>(scope: Scope, subject: Subject) {
  const base = { windowSeconds: 15 * MINUTE, onError: 'closed' } as const;
  return {
    [`auth.${scope}.ip`]: { ...base, limit: 5 },
    [`auth.${scope}.${subject}`]: { ...base, limit: 5 },
    [`auth.${scope}.untrusted`]: { ...base, limit: 50 },
  } as {
    [Key in `auth.${Scope}.ip` | `auth.${Scope}.${Subject}` | `auth.${Scope}.untrusted`]: {
      readonly limit: number;
      readonly windowSeconds: number;
      readonly onError: 'closed';
    };
  };
}

/** Security control 11. Keys: IP / email for auth, session id for `api`, pool id for the rest. */
export const RATE_LIMIT_BUCKETS = {
  ...authScope('signin', 'email'),
  ...authScope('verify', 'email'),
  ...authScope('reset', 'email'),
  // Creating accounts (only reachable when sign-up is open or with an invite).
  ...authScope('signup', 'email'),
  // Changing the password or the email of a signed-in account (wrong current password counts).
  ...authScope('account', 'user'),
  // Verification emails per address, whatever asked for them (sign-up, sign-in, resend button,
  // sign-up of an unverified address). One per minute, ten per hour; over that nothing is sent but the
  // request still gets its usual answer. Keyed by email.
  'auth.verifymail.cooldown': { limit: 1, windowSeconds: MINUTE, onError: 'closed' },
  'auth.verifymail.hour': { limit: 10, windowSeconds: HOUR, onError: 'closed' },
  api: { limit: 300, windowSeconds: MINUTE, onError: 'open' },
  imports: { limit: 20, windowSeconds: HOUR, onError: 'open' },
  invites: { limit: 20, windowSeconds: DAY, onError: 'open' },
  // The public invite page and the invite check of sign-up: keyed by client IP (loose, tokens are
  // 256 random bits, so this only keeps strangers from hammering the lookup).
  'invites.lookup': { limit: 60, windowSeconds: MINUTE, onError: 'open' },
} satisfies Record<string, BucketDefinition>;

export type RateLimitBucket = keyof typeof RATE_LIMIT_BUCKETS;
