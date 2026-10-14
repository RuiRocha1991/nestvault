import { describe, expect, it } from 'vitest';

import { maskIp, parseUserAgent, SessionDto, UpdateProfileInput } from '@nestvault/services';

describe('maskIp', () => {
  it('hides the end of an IPv4 address, also when it is mapped into IPv6', () => {
    expect(maskIp('85.240.12.34')).toBe('85.240.x.x');
    expect(maskIp('::ffff:192.168.1.20')).toBe('192.168.x.x');
  });

  it('keeps only the start of an IPv6 address', () => {
    expect(maskIp('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8:…');
  });

  it('gives null for nothing, or for what is not an address', () => {
    expect(maskIp(null)).toBeNull();
    expect(maskIp('')).toBeNull();
    expect(maskIp('untrusted-proxy')).toBeNull();
    expect(maskIp("' OR 1=1 --")).toBeNull();
    expect(maskIp('999.1.1')).toBeNull();
  });
});

describe('parseUserAgent', () => {
  const cases: [string, string, string, 'desktop' | 'mobile'][] = [
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      'Chrome',
      'macOS',
      'desktop',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
      'Safari',
      'iPhone',
      'mobile',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
      'Firefox',
      'Windows',
      'desktop',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
      'Edge',
      'Windows',
      'desktop',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36',
      'Chrome',
      'Android',
      'mobile',
    ],
  ];

  it.each(cases)('reads %s', (agent, browser, os, kind) => {
    expect(parseUserAgent(agent)).toEqual({ browser, os, kind });
  });

  it('copes with a missing or unknown agent', () => {
    expect(parseUserAgent(null)).toEqual({ browser: null, os: null, kind: 'desktop' });
    expect(parseUserAgent('curl/8.0')).toEqual({ browser: null, os: null, kind: 'desktop' });
    expect(parseUserAgent('A'.repeat(100_000)).browser).toBeNull();
  });
});

describe('account schemas', () => {
  it('accepts only a trimmed name of 1 to 120 characters', () => {
    expect(UpdateProfileInput.parse({ name: '  Ana ' })).toEqual({ name: 'Ana' });
    expect(UpdateProfileInput.safeParse({ name: '' }).success).toBe(false);
    expect(UpdateProfileInput.safeParse({ name: 'a'.repeat(121) }).success).toBe(false);
    expect(UpdateProfileInput.safeParse({ name: 'Ana', role: 'owner' }).success).toBe(false);
  });

  it('drops anything the session DTO does not name', () => {
    const parsed = SessionDto.parse({
      id: crypto.randomUUID(),
      current: true,
      browser: 'Chrome',
      os: 'macOS',
      kind: 'desktop',
      ipMasked: '1.2.x.x',
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      token: 'secret',
    });
    expect(parsed).not.toHaveProperty('token');
  });
});
