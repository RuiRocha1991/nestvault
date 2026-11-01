import { describe, expect, it } from 'vitest';

import { dueDate, monthsBefore, REMINDER_WINDOW_MONTHS } from '@nestvault/services';

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

describe('dueDate', () => {
  it('is the plan day in a month that has it', () => {
    expect(dueDate('2026-06', 5)).toBe('2026-06-05');
    expect(dueDate('2026-07', 31)).toBe('2026-07-31');
  });

  it('falls on the last day of a shorter month', () => {
    expect(dueDate('2026-02', 31)).toBe('2026-02-28');
    expect(dueDate('2026-02', 29)).toBe('2026-02-28');
    expect(dueDate('2028-02', 30)).toBe('2028-02-29'); // leap year
    expect(dueDate('2026-04', 31)).toBe('2026-04-30');
  });
});
