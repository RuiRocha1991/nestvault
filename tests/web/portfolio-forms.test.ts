import { describe, expect, it } from 'vitest';

import {
  decimalOrNull,
  emptyOpForm,
  missingOpFields,
  normalizeDecimal,
  opBody,
  poolApi,
  rowsToTargets,
  targetsToRows,
} from '../../apps/web/src/lib/portfolio-forms';

const base = emptyOpForm({ date: '2026-03-10', portfolioId: 'p', assetId: 'a' });

describe('decimal input', () => {
  it('accepts a comma and strips spaces', () => {
    expect(normalizeDecimal(' 1 234,5 ')).toBe('1234.5');
    expect(decimalOrNull('')).toBeNull();
    expect(decimalOrNull('  ')).toBeNull();
    expect(decimalOrNull('2,25')).toBe('2.25');
  });
});

describe('operation form', () => {
  it('needs quantity and price for a buy and the net amount for a dividend', () => {
    expect(missingOpFields(base)).toEqual(['qty', 'price']);
    expect(missingOpFields({ ...base, qty: '1', price: '2' })).toEqual([]);
    expect(missingOpFields({ ...base, type: 'dividend' })).toEqual(['amount']);
    expect(missingOpFields({ ...base, portfolioId: '' })).toContain('portfolioId');
  });

  it('sends only the fields of a buy, with empty optionals as null', () => {
    const body = opBody({
      ...base,
      qty: '2,5',
      price: '10',
      fee: '',
      accountId: 'acc',
      fromCash: true,
    });
    expect(body).toEqual({
      portfolioId: 'p',
      assetId: 'a',
      type: 'buy',
      date: '2026-03-10',
      accountId: 'acc',
      subAccountId: null,
      note: null,
      qty: '2.5',
      price: '10',
      fee: null,
      fromCash: true,
      amount: null,
      gross: null,
      tax: null,
    });
  });

  it('never sends quantity or fromCash for a dividend, nor a sub-account without an account', () => {
    const body = opBody({
      ...base,
      type: 'dividend',
      qty: '9',
      price: '9',
      fromCash: true,
      amount: '4,24',
      gross: '5',
      tax: '0.76',
      subAccountId: 'sub',
      note: '  trimestral ',
    });
    expect(body).toMatchObject({
      type: 'dividend',
      qty: null,
      price: null,
      fee: null,
      fromCash: false,
      amount: '4.24',
      gross: '5',
      tax: '0.76',
      subAccountId: null,
      note: 'trimestral',
    });
  });

  it('only a buy can be paid from the portfolio cash', () => {
    expect(opBody({ ...base, type: 'sell', qty: '1', price: '1', fromCash: true }).fromCash).toBe(
      false,
    );
  });
});

describe('targets and API paths', () => {
  it('turns targets into rows and back, dropping blank rows', () => {
    expect(targetsToRows({ etf: '60', VWCE: '40' })).toEqual([
      { label: 'etf', percent: '60' },
      { label: 'VWCE', percent: '40' },
    ]);
    expect(
      rowsToTargets([
        { label: ' etf ', percent: '60,5' },
        { label: '', percent: '10' },
        { label: 'x', percent: '' },
      ]),
    ).toEqual({ etf: '60.5' });
  });

  it('encodes every segment of a pool API path', () => {
    expect(poolApi('p', 'ops', 'a/b')).toBe('/api/v1/pools/p/ops/a%2Fb');
    expect(poolApi('p?x', 'portfolios')).toBe('/api/v1/pools/p%3Fx/portfolios');
  });
});
