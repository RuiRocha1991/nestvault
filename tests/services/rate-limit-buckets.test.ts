import { describe, expect, it } from 'vitest';

import { RATE_LIMIT_BUCKETS } from '../../packages/services/src/rate-limit/buckets';

describe('rate limit buckets', () => {
  it('has a per-IP, a per-subject and a shared bucket for every auth scope', () => {
    const names = Object.keys(RATE_LIMIT_BUCKETS).filter((name) => name.startsWith('auth.'));
    expect(names.sort()).toEqual(
      [
        'auth.account.ip',
        'auth.account.untrusted',
        'auth.account.user',
        'auth.reset.email',
        'auth.reset.ip',
        'auth.reset.untrusted',
        'auth.signin.email',
        'auth.signin.ip',
        'auth.signin.untrusted',
        'auth.signup.email',
        'auth.signup.ip',
        'auth.signup.untrusted',
        'auth.verify.email',
        'auth.verify.ip',
        'auth.verify.untrusted',
      ].sort(),
    );
  });

  it('allows 5 attempts in 15 minutes (50 for the shared bucket) and fails closed', () => {
    for (const [name, definition] of Object.entries(RATE_LIMIT_BUCKETS)) {
      if (!name.startsWith('auth.')) continue;
      expect(definition.windowSeconds, name).toBe(15 * 60);
      expect(definition.limit, name).toBe(name.endsWith('.untrusted') ? 50 : 5);
      expect(definition.onError, name).toBe('closed');
    }
  });

  it('keeps the other buckets as they were', () => {
    expect(RATE_LIMIT_BUCKETS.api).toEqual({ limit: 300, windowSeconds: 60, onError: 'open' });
    expect(RATE_LIMIT_BUCKETS.imports.limit).toBe(20);
    expect(RATE_LIMIT_BUCKETS.invites.limit).toBe(20);
  });
});
