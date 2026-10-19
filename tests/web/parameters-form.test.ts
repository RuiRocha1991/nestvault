import { describe, expect, it } from 'vitest';

import { buildPatch, toDecimal, toText, type ParametersForm } from '@webapp/lib/parameters-form';

const MARKET = { USD: '0.92', GBP: '1.17', CHF: '1.06' };
const form = (overrides: Partial<ParametersForm> = {}): ParametersForm => ({
  rates: { USD: '0,92', GBP: '1,17', CHF: '1,06' },
  depositTax: '28',
  dividendTax: '28',
  transferWindowDays: '3',
  ...overrides,
});

describe('parameters form', () => {
  it('reads a decimal comma and shows one', () => {
    expect(toDecimal(' 0,92 ')).toBe('0.92');
    expect(toDecimal('1.17')).toBe('1.17');
    expect(toText('0.92')).toBe('0,92');
  });

  it('sends no override for a rate equal to the market rate', () => {
    expect(buildPatch(form(), MARKET)).toEqual({
      depositTax: '28',
      dividendTax: '28',
      transferWindowDays: 3,
      fxOverrides: {},
    });
  });

  it('sends an override for a rate that differs, and keeps overrides of other currencies', () => {
    const patch = buildPatch(form({ rates: { USD: '0,8', GBP: '1,17', CHF: '1,06' } }), MARKET, {
      JPY: '0.006',
      USD: '0.5',
    });
    expect(patch?.fxOverrides).toEqual({ JPY: '0.006', USD: '0.8' });
  });

  it('passes through a value the server must reject, and refuses a window that is not a whole number', () => {
    expect(buildPatch(form({ depositTax: '-1' }), MARKET)?.depositTax).toBe('-1');
    expect(
      buildPatch(form({ rates: { USD: 'abc', GBP: '1,17', CHF: '1,06' } }), MARKET)?.fxOverrides,
    ).toEqual({
      USD: 'abc',
    });
    expect(buildPatch(form({ transferWindowDays: '2,5' }), MARKET)).toBeNull();
    expect(buildPatch(form({ transferWindowDays: '' }), MARKET)).toBeNull();
  });
});
