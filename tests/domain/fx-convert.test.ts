import { describe, expect, it } from 'vitest';

import { convertCurrency, fromEur, toPlain } from '@nestvault/domain';

const rates = { USD: '0.92', GBP: '1.17' };

describe('convertCurrency', () => {
  it('converts through EUR with decimal arithmetic', () => {
    expect(toPlain(convertCurrency('1361.87', 'USD', 'EUR', rates))).toBe('1252.9204');
    expect(toPlain(convertCurrency('1252.9204', 'EUR', 'USD', rates))).toBe('1361.87');
    // 100 GBP -> 117 EUR -> 127.173913... USD
    expect(convertCurrency('100', 'GBP', 'USD', rates).toDecimalPlaces(6).toString()).toBe(
      '127.173913',
    );
  });

  it('leaves an amount alone when both currencies are the same, and treats unknown rates as 1', () => {
    expect(toPlain(convertCurrency('10.5', 'USD', 'USD', rates))).toBe('10.5');
    expect(toPlain(convertCurrency('10.5', 'XXX', 'EUR', rates))).toBe('10.5');
    expect(toPlain(fromEur('92', 'USD', rates))).toBe('100');
  });
});
