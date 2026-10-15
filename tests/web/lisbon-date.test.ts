import { describe, expect, it } from 'vitest';

import {
  addDays,
  isYmd,
  lisbonDateTime,
  lisbonDayStart,
  parseTypedDate,
  todayInLisbon,
} from '@webapp/lib/lisbon-date';

describe('lisbonDayStart', () => {
  it.each([
    ['2026-01-15', '2026-01-15T00:00:00.000Z'], // winter: Lisbon is on UTC
    ['2026-07-15', '2026-07-14T23:00:00.000Z'], // summer: Lisbon is one hour ahead
    ['2026-03-29', '2026-03-29T00:00:00.000Z'], // clocks go forward at 01:00 that night
    ['2026-03-30', '2026-03-29T23:00:00.000Z'],
    ['2026-10-25', '2026-10-24T23:00:00.000Z'], // clocks go back at 02:00 that night
    ['2026-10-26', '2026-10-26T00:00:00.000Z'],
  ])('starts %s at %s', (day, instant) => {
    expect(lisbonDayStart(day).toISOString()).toBe(instant);
  });

  it('refuses something that is not a day', () => {
    expect(() => lisbonDayStart('15/07/2026')).toThrow(RangeError);
  });
});

describe('todayInLisbon and lisbonDateTime', () => {
  it('reads the Lisbon calendar day, not the UTC one', () => {
    expect(todayInLisbon(new Date('2026-07-14T23:30:00Z'))).toBe('2026-07-15');
    expect(todayInLisbon(new Date('2026-01-14T23:30:00Z'))).toBe('2026-01-14');
  });

  it('shows an instant on the Lisbon wall clock with 24 hour time', () => {
    expect(lisbonDateTime('2026-10-14T08:41:07Z')).toEqual({
      date: '2026-10-14',
      time: '09:41:07',
    });
    expect(lisbonDateTime(new Date('2026-12-31T23:59:59Z'))).toEqual({
      date: '2026-12-31',
      time: '23:59:59',
    });
    expect(lisbonDateTime('2026-07-14T23:00:00Z')).toEqual({
      date: '2026-07-15',
      time: '00:00:00',
    });
  });
});

describe('addDays', () => {
  it.each([
    ['2026-10-14', -30, '2026-09-14'],
    ['2026-03-01', -1, '2026-02-28'],
    ['2028-03-01', -1, '2028-02-29'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2026-10-14', 0, '2026-10-14'],
  ])('%s %i days is %s', (day, days, expected) => {
    expect(addDays(day, days)).toBe(expected);
  });
});

describe('isYmd and parseTypedDate', () => {
  it('accepts real days only', () => {
    expect(isYmd('2026-02-28')).toBe(true);
    expect(isYmd('2026-02-30')).toBe(false);
    expect(isYmd('2026-13-01')).toBe(false);
    expect(isYmd('26-01-01')).toBe(false);
    expect(isYmd('')).toBe(false);
  });

  it('reads dd/mm/aaaa', () => {
    expect(parseTypedDate('14/09/2026')).toBe('2026-09-14');
    expect(parseTypedDate(' 4/9/2026 ')).toBe('2026-09-04');
    expect(parseTypedDate('31/02/2026')).toBeNull();
    expect(parseTypedDate('2026-09-14')).toBeNull();
    expect(parseTypedDate('14/09/26')).toBeNull();
    expect(parseTypedDate('')).toBeNull();
  });
});
