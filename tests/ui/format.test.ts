import { describe, expect, it } from 'vitest';

import { formatDate, formatMoney, formatPct } from '@nestvault/ui';

const NBSP = ' ';

describe('formatMoney', () => {
  it('formats EUR as 1 234,56 € with non-breaking spaces', () => {
    expect(formatMoney('1234.56', 'EUR')).toBe(`1${NBSP}234,56${NBSP}€`);
    expect(formatMoney(1234.56, 'EUR')).toBe(`1${NBSP}234,56${NBSP}€`);
  });

  it('formats USD with the US$ symbol', () => {
    expect(formatMoney('1361.87', 'USD')).toBe(`1${NBSP}361,87${NBSP}US$`);
  });

  it('rounds to whole units with digits: 0, as the overview totals do', () => {
    expect(formatMoney('89325.5', 'EUR', { digits: 0 })).toBe(`89${NBSP}326${NBSP}€`);
    expect(formatMoney('-0.4', 'EUR', { digits: 0 })).toBe(`0${NBSP}€`);
    expect(formatMoney('1234.5', 'EUR', { digits: 1 })).toBe(`1${NBSP}234,5${NBSP}€`);
  });

  it('defaults to EUR', () => {
    expect(formatMoney('5')).toBe(`5,00${NBSP}€`);
  });

  it('groups only from four digits and never splits small numbers', () => {
    expect(formatMoney('999.99')).toBe(`999,99${NBSP}€`);
    expect(formatMoney('12345678.9')).toBe(`12${NBSP}345${NBSP}678,90${NBSP}€`);
  });

  it('rounds half away from zero without floating point', () => {
    expect(formatMoney('0.005')).toBe(`0,01${NBSP}€`);
    expect(formatMoney('1234.565')).toBe(`1${NBSP}234,57${NBSP}€`);
    expect(formatMoney('-1234.565')).toBe(`-1${NBSP}234,57${NBSP}€`);
    expect(formatMoney('0.004')).toBe(`0,00${NBSP}€`);
    expect(formatMoney('99999999999999.9999')).toBe(
      `100${NBSP}000${NBSP}000${NBSP}000${NBSP}000,00${NBSP}€`,
    );
  });

  it('shows negative values with a minus and never "-0,00"', () => {
    expect(formatMoney('-1234.5')).toBe(`-1${NBSP}234,50${NBSP}€`);
    expect(formatMoney('-0.001')).toBe(`0,00${NBSP}€`);
  });

  it('rejects values that are not decimal numbers', () => {
    expect(() => formatMoney('12,5')).toThrow(RangeError);
    expect(() => formatMoney('abc')).toThrow(RangeError);
    expect(() => formatMoney(Number.NaN)).toThrow(RangeError);
    expect(() => formatMoney(Infinity)).toThrow(RangeError);
  });
});

describe('formatDate', () => {
  it('formats an ISO date as dd/mm/yyyy', () => {
    expect(formatDate('2026-10-11')).toBe('11/10/2026');
    expect(formatDate('2026-01-05T23:30:00.000Z')).toBe('05/01/2026');
  });

  it('reads a Date in UTC', () => {
    expect(formatDate(new Date(Date.UTC(2026, 11, 31, 23, 59)))).toBe('31/12/2026');
  });

  it('rejects anything that is not an ISO date', () => {
    expect(() => formatDate('11/10/2026')).toThrow(RangeError);
    expect(() => formatDate(new Date('invalid'))).toThrow(RangeError);
  });
});

describe('formatPct', () => {
  it('formats with a decimal comma and one digit by default', () => {
    expect(formatPct(7.3)).toBe('7,3%');
    expect(formatPct('11.25')).toBe('11,3%');
    expect(formatPct(17, { digits: 0 })).toBe('17%');
  });

  it('adds a plus sign only when asked, and never to zero', () => {
    expect(formatPct(7.3, { signed: true })).toBe('+7,3%');
    expect(formatPct(-0.2, { signed: true })).toBe('-0,2%');
    expect(formatPct(0, { signed: true })).toBe('0,0%');
  });
});

describe('formatNumber', () => {
  it('groups thousands and uses a decimal comma, without a currency', async () => {
    const { formatNumber } = await import('@nestvault/ui');
    expect(formatNumber('1234.5')).toBe(`1${NBSP}234,50`);
    expect(formatNumber('16.3')).toBe('16,30');
    expect(formatNumber('-0.004')).toBe('0,00');
    expect(formatNumber('12.3456', 4)).toBe('12,3456');
  });
});
