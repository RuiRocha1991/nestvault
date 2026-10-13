import { describe, expect, it } from 'vitest';

import { DEFAULT_AFTER_SIGN_IN, safeNextPath } from '@nestvault/services';

describe('safeNextPath', () => {
  it.each([
    ['/demo', '/demo'],
    ['/demo/despesas', '/demo/despesas'],
    ['/pools', '/pools'],
    ['/demo/mes/2026-10?tab=notas', '/demo/mes/2026-10?tab=notas'],
    ['/a%20b', '/a%20b'],
    // A path on this host: the userinfo form only works after a scheme and `//`.
    ['/@evil.com', '/@evil.com'],
  ])('keeps the same-origin path %s', (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });

  it.each([
    'https://evil.com',
    'http://evil.com/demo',
    '//evil.com',
    '///evil.com',
    '/\\evil.com',
    '\\\\evil.com',
    '/\t/evil.com',
    '/\n/evil.com',
    '/\r/evil.com',
    '/\u0000/evil.com',
    // Dot segments collapse into a protocol-relative URL once normalized.
    '/..//evil.com',
    '/.//evil.com',
    '/a/..//evil.com',
    '/%2e%2e//evil.com',
    '/%2e//evil.com',
    'javascript:alert(1)',
    'data:text/html,<script>1</script>',
    'evil.com',
    'demo',
    '@evil.com',
    ' /demo',
    '',
  ])('rejects %j', (raw) => {
    expect(safeNextPath(raw)).toBeNull();
  });

  it('rejects missing values', () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
  });

  it('never returns the sign-in page itself (redirect loop)', () => {
    expect(safeNextPath('/login')).toBeNull();
    expect(safeNextPath('/login?next=/demo')).toBeNull();
  });

  it('rejects an absurdly long value', () => {
    expect(safeNextPath(`/${'a'.repeat(3000)}`)).toBeNull();
  });

  it('only ever returns a path starting with a single slash', () => {
    for (const raw of ['/ok', '/x?y=//evil.com', '/x#//evil.com']) {
      const result = safeNextPath(raw);
      expect(result === null || /^\/(?!\/)/.test(result)).toBe(true);
    }
  });

  it('lands on the pool chooser by default', () => {
    expect(DEFAULT_AFTER_SIGN_IN).toBe('/pools');
  });
});
