import { describe, expect, it } from 'vitest';

import { isPoolSegment } from '../../apps/web/src/lib/pool';

describe('isPoolSegment', () => {
  it('accepts UUIDs and simple slugs', () => {
    expect(isPoolSegment('0190f3a2-7b1c-7d3e-9a4b-1c2d3e4f5a6b')).toBe(true);
    expect(isPoolSegment('demo')).toBe(true);
  });

  it('rejects anything that could change a link or markup', () => {
    for (const value of [
      '',
      '/evil.com',
      '//evil.com',
      '..',
      'a/b',
      'a b',
      '"><script>',
      "' OR 1=1 --",
      'a%2Fb',
      'x'.repeat(65),
    ]) {
      expect(isPoolSegment(value), value).toBe(false);
    }
  });
});
