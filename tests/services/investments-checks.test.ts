import { describe, expect, it } from 'vitest';

import { ValidationError } from '@nestvault/services';

import { refOrRethrow, resolvePlacement } from '../../packages/services/src/investments/checks';

const fk = (constraint: string) =>
  new Error('violates foreign key', { cause: { code: '23503', constraint } });

const fieldOf = (error: unknown) => {
  try {
    refOrRethrow(error);
  } catch (caught) {
    if (caught instanceof ValidationError) return caught.issues[0]?.path;
    throw caught;
  }
  return undefined;
};

describe('refOrRethrow', () => {
  it('names the field the broken foreign key is about', () => {
    expect(fieldOf(fk('plans_portfolio_fk'))).toBe('portfolioId');
    expect(fieldOf(fk('investment_ops_asset_fk'))).toBe('assetId');
    expect(fieldOf(fk('investment_ops_account_fk'))).toBe('accountId');
    expect(fieldOf(fk('plans_sub_account_fk'))).toBe('subAccountId');
    expect(fieldOf(fk('something_else'))).toBe('reference');
  });

  it('rethrows what is not a foreign key violation', () => {
    const other = new Error('boom');
    expect(() => refOrRethrow(other)).toThrow(other);
    expect(() => refOrRethrow(new Error('x', { cause: { code: '23505' } }))).toThrow('x');
  });
});

describe('resolvePlacement', () => {
  const base = { accountId: 'a1', subAccountId: 's1' };

  it('keeps both when the patch leaves them out or repeats the account', () => {
    expect(resolvePlacement(base, {})).toEqual(base);
    expect(resolvePlacement(base, { accountId: 'A1' })).toEqual(base);
  });

  it('clears the sub-account when the account is cleared or changes', () => {
    expect(resolvePlacement(base, { accountId: null })).toEqual({
      accountId: null,
      subAccountId: null,
    });
    expect(resolvePlacement(base, { accountId: 'a2' })).toEqual({
      accountId: 'a2',
      subAccountId: null,
    });
  });

  it('takes a sub-account sent together with the account, lower-cased', () => {
    expect(resolvePlacement(base, { accountId: 'a2', subAccountId: 'S2' })).toEqual({
      accountId: 'a2',
      subAccountId: 's2',
    });
    expect(resolvePlacement(base, { subAccountId: null })).toEqual({
      accountId: 'a1',
      subAccountId: null,
    });
  });
});
