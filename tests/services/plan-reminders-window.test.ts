import { describe, expect, it } from 'vitest';

import { monthsBefore, REMINDER_WINDOW_MONTHS } from '@nestvault/services';

describe('reminder window', () => {
  it('is the current month and the two before it', () => {
    expect(REMINDER_WINDOW_MONTHS).toBe(3);
  });

  it('counts months back across year boundaries', () => {
    expect(monthsBefore('2026-06', 0)).toBe('2026-06');
    expect(monthsBefore('2026-06', 2)).toBe('2026-04');
    expect(monthsBefore('2026-02', 2)).toBe('2025-12');
    expect(monthsBefore('2026-01', 1)).toBe('2025-12');
    expect(monthsBefore('2026-12', 11)).toBe('2026-01');
  });
});
