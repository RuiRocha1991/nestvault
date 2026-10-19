import { describe, expect, it } from 'vitest';

import { resolveFxRates, toEur, toFxRates, type MarketFxRate } from '@nestvault/domain';

const market = (currency: string, rate: string, date = '2026-01-01'): MarketFxRate => ({
  currency,
  rate,
  date,
  source: 'seed',
});

describe('resolveFxRates', () => {
  it('uses the seed constants when no market rate is dated', () => {
    const resolved = resolveFxRates({ market: [], overrides: {} });
    expect(resolved.map((entry) => entry.currency)).toEqual(['CHF', 'GBP', 'USD']);
    expect(resolved.find((entry) => entry.currency === 'USD')).toEqual({
      currency: 'USD',
      rate: '0.92',
      marketRate: '0.92',
      source: 'default',
      date: null,
    });
  });

  it('prefers the market rate to the seed and normalizes the decimals', () => {
    const [usd] = resolveFxRates({
      market: [market('USD', '0.95000000', '2026-02-03')],
      overrides: {},
    }).filter((entry) => entry.currency === 'USD');
    expect(usd).toEqual({
      currency: 'USD',
      rate: '0.95',
      marketRate: '0.95',
      source: 'seed',
      date: '2026-02-03',
    });
  });

  it('lets the pool override win and keeps the market rate next to it', () => {
    const resolved = resolveFxRates({
      market: [market('USD', '0.95')],
      overrides: { USD: '0.9' },
    });
    expect(resolved.find((entry) => entry.currency === 'USD')).toMatchObject({
      rate: '0.9',
      marketRate: '0.95',
      source: 'pool',
    });
    // Another currency is not touched by it.
    expect(resolved.find((entry) => entry.currency === 'GBP')).toMatchObject({ rate: '1.17' });
  });

  it('ignores a malformed or non-positive override', () => {
    const resolved = resolveFxRates({
      market: [],
      overrides: { USD: '0', GBP: 'abc', CHF: '-1' },
    });
    expect(toFxRates(resolved)).toEqual({ CHF: '1.06', GBP: '1.17', USD: '0.92' });
  });

  it('knows a currency that only the pool defines', () => {
    const resolved = resolveFxRates({ market: [], overrides: { JPY: '0.0062' } });
    expect(resolved.find((entry) => entry.currency === 'JPY')).toEqual({
      currency: 'JPY',
      rate: '0.0062',
      marketRate: '0.0062',
      source: 'pool',
      date: null,
    });
    expect(
      resolveFxRates({ market: [], overrides: { JPY: 'nope' } }).map((e) => e.currency),
    ).not.toContain('JPY');
  });

  it('falls back to the seed when a stored market rate is unusable', () => {
    const resolved = resolveFxRates({ market: [market('USD', '0')], overrides: {} });
    expect(resolved.find((entry) => entry.currency === 'USD')?.source).toBe('default');
  });

  it('feeds the calculations: an override changes the EUR value of that pool only', () => {
    const poolA = toFxRates(resolveFxRates({ market: [], overrides: { USD: '0.8' } }));
    const poolB = toFxRates(resolveFxRates({ market: [], overrides: {} }));
    expect(toEur('100', 'USD', poolA).toString()).toBe('80');
    expect(toEur('100', 'USD', poolB).toString()).toBe('92');
  });
});
