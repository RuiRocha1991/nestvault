import { describe, expect, it } from 'vitest';

import { loginUrl } from '../../apps/web/src/lib/auth-redirect';
import {
  formatCountdown,
  interpretSignInResponse,
  parseRetryAfter,
  signInSchema,
} from '../../apps/web/src/lib/sign-in';

describe('signInSchema', () => {
  it('accepts an email and a password', () => {
    expect(signInSchema.safeParse({ email: 'ana@example.com', password: 'x' }).success).toBe(true);
  });

  it.each([
    { email: '', password: 'x' },
    { email: 'not-an-email', password: 'x' },
    { email: 'ana@example.com', password: '' },
    { email: 'ana@example.com' },
    { email: 'ana@example.com', password: 'x', role: 'owner' },
    { email: 'ana@example.com', password: 'x'.repeat(129) },
  ])('rejects %j', (input) => {
    expect(signInSchema.safeParse(input).success).toBe(false);
  });
});

describe('interpretSignInResponse', () => {
  it('signs in on 200', () => {
    expect(interpretSignInResponse(200, null)).toEqual({ status: 'ok' });
  });

  it.each([400, 401, 403])('shows the same generic message for %i', (status) => {
    expect(interpretSignInResponse(status, null)).toEqual({ status: 'invalid' });
  });

  it('reads Retry-After on 429', () => {
    expect(interpretSignInResponse(429, '872')).toEqual({
      status: 'rate_limited',
      retryAfterSeconds: 872,
    });
  });

  it('treats other failures as a technical error', () => {
    expect(interpretSignInResponse(500, null)).toEqual({ status: 'error' });
    expect(interpretSignInResponse(502, null)).toEqual({ status: 'error' });
  });
});

describe('parseRetryAfter', () => {
  it('falls back to a minute for a missing or odd header', () => {
    for (const value of [null, '', 'soon', '-5', '0', '1.5', 'Wed, 21 Oct 2026 07:28:00 GMT']) {
      expect(parseRetryAfter(value)).toBe(60);
    }
  });

  it('caps the wait at a day', () => {
    expect(parseRetryAfter('999999')).toBe(86_400);
  });
});

describe('formatCountdown', () => {
  it('formats m:ss', () => {
    expect(formatCountdown(872)).toBe('14:32');
    expect(formatCountdown(65)).toBe('1:05');
    expect(formatCountdown(9)).toBe('0:09');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-3)).toBe('0:00');
  });
});

describe('loginUrl', () => {
  it('carries a safe requested path in next', () => {
    expect(loginUrl('/demo/despesas?m=2026-10')).toBe(
      '/login?next=%2Fdemo%2Fdespesas%3Fm%3D2026-10',
    );
  });

  it('adds reason=expired when a session cookie stopped working', () => {
    expect(loginUrl('/demo', { expired: true })).toBe('/login?next=%2Fdemo&reason=expired');
    expect(loginUrl(null, { expired: true })).toBe('/login?reason=expired');
    expect(loginUrl('//evil.com', { expired: true })).toBe('/login?reason=expired');
  });

  it('drops an unsafe or missing path', () => {
    expect(loginUrl('//evil.com')).toBe('/login');
    expect(loginUrl('https://evil.com')).toBe('/login');
    expect(loginUrl('/login')).toBe('/login');
    expect(loginUrl(null)).toBe('/login');
  });
});
