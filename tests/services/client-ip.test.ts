import { describe, expect, it } from 'vitest';

import { getClientIp, UNTRUSTED_CLIENT_KEY } from '@nestvault/services';

const headers = (xff?: string) => new Headers(xff ? { 'x-forwarded-for': xff } : {});

describe('getClientIp', () => {
  it('ignores a spoofed x-forwarded-for when no proxy is trusted', () => {
    expect(getClientIp(headers('6.6.6.6'), 0)).toBe(UNTRUSTED_CLIENT_KEY);
    expect(getClientIp(headers('6.6.6.6, 7.7.7.7'), 0)).toBe(UNTRUSTED_CLIENT_KEY);
  });

  it('takes the entry the trusted proxy appended, not what the client put in front of it', () => {
    expect(getClientIp(headers('6.6.6.6, 203.0.113.9'), 1)).toBe('203.0.113.9');
    expect(getClientIp(headers('6.6.6.6, 203.0.113.9, 10.0.0.2'), 2)).toBe('203.0.113.9');
  });

  it('falls back to the shared key when the header is missing, short or not an address', () => {
    expect(getClientIp(headers(), 1)).toBe(UNTRUSTED_CLIENT_KEY);
    expect(getClientIp(headers('203.0.113.9'), 2)).toBe(UNTRUSTED_CLIENT_KEY);
    expect(getClientIp(headers("'; DROP TABLE x; --"), 1)).toBe(UNTRUSTED_CLIENT_KEY);
  });

  it('accepts IPv6', () => {
    expect(getClientIp(headers('2001:db8::1'), 1)).toBe('2001:db8::1');
  });
});
