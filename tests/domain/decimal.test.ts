import { describe, expect, it } from 'vitest';

import {
  add,
  compare,
  dec,
  div,
  DEFAULT_FX_RATES,
  fx,
  mul,
  roundCents,
  roundTo,
  sub,
  sum,
  toEur,
  toPlain,
} from '@nestvault/domain';

describe('decimal arithmetic', () => {
  it('adds without float error: 0.1 + 0.2 = 0.3', () => {
    expect(toPlain(add('0.1', '0.2'))).toBe('0.3');
    expect(compare(add('0.1', '0.2'), '0.3')).toBe(0);
  });

  it('subtracts, multiplies and divides', () => {
    expect(toPlain(sub('1', '0.9'))).toBe('0.1');
    expect(toPlain(mul('1.1', '1.1'))).toBe('1.21');
    expect(toPlain(div('1', '8'))).toBe('0.125');
  });

  it('refuses to divide by zero', () => {
    expect(() => div('1', '0')).toThrow(RangeError);
  });

  it('sums any iterable and an empty one is zero', () => {
    expect(toPlain(sum(['0.1', 0.2, dec('0.3')]))).toBe('0.6');
    expect(toPlain(sum([]))).toBe('0');
  });

  it('compares like a sort function', () => {
    expect(compare('2', '10')).toBeLessThan(0);
    expect(compare('10', '2')).toBeGreaterThan(0);
  });

  it('rounds half up: 2.675 -> 2.68 and -2.675 -> -2.68', () => {
    expect(toPlain(roundCents('2.675'))).toBe('2.68');
    expect(toPlain(roundCents('-2.675'))).toBe('-2.68');
    expect(toPlain(roundCents('2.674'))).toBe('2.67');
    expect(toPlain(roundTo('0.123456789', 8))).toBe('0.12345679');
  });

  it('prints without an exponent and never as -0', () => {
    expect(toPlain('1e-7')).toBe('0.0000001');
    expect(toPlain('1e21')).toBe('1000000000000000000000');
    expect(toPlain('-0')).toBe('0');
    expect(toPlain(roundCents('-0.001'))).toBe('0');
  });

  it('keeps 20 digit quantities exact', () => {
    expect(toPlain(mul('12345678901234.12345678', '1'))).toBe('12345678901234.12345678');
  });
});

describe('fx', () => {
  const rates = DEFAULT_FX_RATES;

  it('is 1 for EUR, empty and unknown currencies', () => {
    expect(toPlain(fx('EUR', rates))).toBe('1');
    expect(toPlain(fx(null, rates))).toBe('1');
    expect(toPlain(fx(undefined, rates))).toBe('1');
    expect(toPlain(fx('JPY', rates))).toBe('1');
  });

  it('reads the rate it is given and ignores invalid ones', () => {
    expect(toPlain(fx('USD', rates))).toBe('0.92');
    expect(toPlain(fx('USD', { USD: '0.5' }))).toBe('0.5');
    expect(toPlain(fx('USD', { USD: '0' }))).toBe('1');
    expect(toPlain(fx('USD', { USD: '-2' }))).toBe('1');
  });

  it('converts to EUR', () => {
    expect(toPlain(toEur('100', 'USD', rates))).toBe('92');
    expect(toPlain(toEur('100', 'EUR', rates))).toBe('100');
  });
});
