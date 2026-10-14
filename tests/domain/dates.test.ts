import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  daysBetween,
  isIsoDate,
  lastMonths,
  monthEnd,
  monthKey,
  monthsBetween,
} from '@nestvault/domain';

describe('isIsoDate', () => {
  it.each([
    ['2026-02-28', true],
    ['2024-02-29', true],
    ['2026-02-29', false],
    ['2026-13-01', false],
    ['2026-1-01', false],
    ['26-01-01', false],
    ['not a date', false],
  ])('%s -> %s', (value, expected) => {
    expect(isIsoDate(value)).toBe(expected);
  });
});

describe('addMonths', () => {
  it.each([
    ['2026-01-31', 1, '2026-02-28'],
    ['2024-01-31', 1, '2024-02-29'],
    ['2026-03-31', -1, '2026-02-28'],
    ['2026-01-15', 1, '2026-02-15'],
    ['2026-11-30', 3, '2027-02-28'],
    ['2026-01-31', 12, '2027-01-31'],
    ['2026-01-15', -13, '2024-12-15'],
    ['2026-05-31', 0, '2026-05-31'],
    ['2028-02-29', 12, '2029-02-28'],
  ])('%s + %i months = %s', (date, months, expected) => {
    expect(addMonths(date, months)).toBe(expected);
  });

  it('rejects text that is not a real date', () => {
    expect(() => addMonths('2026-02-30', 1)).toThrow(RangeError);
    expect(() => addMonths('nope', 1)).toThrow(RangeError);
  });
});

describe('addDays and daysBetween', () => {
  it('crosses month, year and leap day boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('counts days across DST changes as whole days', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
    expect(daysBetween('2026-05-10', '2026-05-01')).toBe(-9);
  });
});

describe('months', () => {
  it('monthKey and monthEnd', () => {
    expect(monthKey('2026-02-14')).toBe('2026-02');
    expect(monthEnd('2026-02')).toBe('2026-02-28');
    expect(monthEnd('2024-02')).toBe('2024-02-29');
    expect(monthEnd('2026-12')).toBe('2026-12-31');
    expect(() => monthEnd('2026-13')).toThrow(RangeError);
    expect(() => monthKey('2026-13-01')).toThrow(RangeError);
  });

  it('monthsBetween ignores the day and accepts month keys', () => {
    expect(monthsBetween('2026-01-31', '2026-02-01')).toBe(1);
    expect(monthsBetween('2026-03', '2025-12')).toBe(-3);
    expect(monthsBetween('2026-05-10', '2026-05-30')).toBe(0);
  });

  it('lastMonths ends in the month of asOf, oldest first', () => {
    expect(lastMonths(3, '2026-01-31')).toEqual(['2025-11', '2025-12', '2026-01']);
    expect(lastMonths(1, '2026-06-15')).toEqual(['2026-06']);
    expect(lastMonths(0, '2026-06-15')).toEqual([]);
  });
});
