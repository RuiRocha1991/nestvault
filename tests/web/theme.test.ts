import { describe, expect, it } from 'vitest';

import { DEFAULT_THEME, parseTheme } from '../../apps/web/src/lib/theme';

describe('parseTheme', () => {
  it('accepts the two known themes', () => {
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('light')).toBe('light');
  });

  it('defaults to dark when the cookie is missing', () => {
    expect(DEFAULT_THEME).toBe('dark');
    expect(parseTheme(undefined)).toBe('dark');
  });

  it('ignores anything else a client may send in the cookie', () => {
    for (const value of ['', 'LIGHT', 'blue', '"><script>', 'light; Path=/', 'constructor']) {
      expect(parseTheme(value)).toBe('dark');
    }
  });
});
