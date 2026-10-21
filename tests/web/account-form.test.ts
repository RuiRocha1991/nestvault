import { describe, expect, it } from 'vitest';

import {
  accountBody,
  defaultDepositName,
  depositBody,
  emptyAccountForm,
  interestBody,
  parseDecimal,
  parsePercent,
  parsePeriod,
  productBody,
  emptyProductForm,
  serverFields,
  validateAccount,
  validateInterest,
  validateProduct,
} from '../../apps/web/src/lib/account-form';

describe('number parsing', () => {
  it('accepts a decimal comma and thousands spaces', () => {
    expect(parseDecimal('1 234,5')).toBe('1234.5');
    expect(parseDecimal('1234.56')).toBe('1234.56');
    expect(parseDecimal('1,23456')).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
  });

  it('keeps percentages between 0 and 100', () => {
    expect(parsePercent('2,5')).toBe('2.5');
    expect(parsePercent('100')).toBe('100');
    expect(parsePercent('100,1')).toBeNull();
    expect(parsePercent('-1')).toBeNull();
  });

  it('keeps periods to whole numbers from 1 to 3650', () => {
    expect(parsePeriod('12')).toBe(12);
    expect(parsePeriod('0')).toBeNull();
    expect(parsePeriod('1,5')).toBeNull();
    expect(parsePeriod('3651')).toBeNull();
  });
});

describe('account form', () => {
  const base = { ...emptyAccountForm('checking'), name: 'BPI', holderIds: ['h1'] };

  it('needs a name and at least one holder', () => {
    expect(validateAccount(emptyAccountForm())).toEqual({
      name: 'required',
      holderIds: 'required',
    });
    expect(validateAccount(base)).toEqual({});
  });

  it('flags a bad opening balance and a bad savings rate', () => {
    expect(validateAccount({ ...base, opening: '12,3456789' }).opening).toBe('invalid');
    expect(validateAccount({ ...base, type: 'savings', rate: '250' }).rate).toBe('invalid');
  });

  it('asks for the deposit fields of a term deposit but not for a name', () => {
    const term = { ...emptyAccountForm('term_deposit'), holderIds: ['h1'] };
    expect(validateAccount(term)).toEqual({
      rate: 'required',
      capital: 'required',
      start: 'required',
    });
    expect(
      validateAccount({ ...term, rate: '2,5', capital: '0', start: '2026-01-10', payN: 'x' }),
    ).toEqual({ capital: 'invalid', pay: 'invalid' });
  });

  it('rejects repeated sub-account names', () => {
    const broker = {
      ...emptyAccountForm('brokerage'),
      name: 'Banco Invest',
      holderIds: ['h1'],
      subAccounts: [
        { name: 'Rui', holderId: '' },
        { name: ' rui ', holderId: '' },
      ],
    };
    expect(validateAccount(broker).subAccounts).toBe('invalid');
  });

  it('builds a strict create body without pool, id or author', () => {
    const body = accountBody(
      { ...base, iban: ' PT50 0002 ', opening: '1 000,5', currency: 'USD' },
      'create',
    );
    expect(body).toMatchObject({
      type: 'checking',
      name: 'BPI',
      currency: 'USD',
      opening: '1000.5',
      iban: 'PT50 0002',
      holderIds: ['h1'],
    });
    expect(Object.keys(body)).not.toContain('poolId');
    expect(Object.keys(body)).not.toContain('id');
  });

  it('leaves the type out of an update and sends sub-accounts only on create', () => {
    const broker = {
      ...emptyAccountForm('brokerage'),
      name: 'B',
      holderIds: ['h1'],
      subAccounts: [{ name: 'Rui', holderId: 'h1' }],
    };
    expect(accountBody(broker, 'update')).not.toHaveProperty('type');
    expect(accountBody(broker, 'update')).not.toHaveProperty('subAccounts');
    expect(accountBody(broker, 'create')).toMatchObject({
      subAccounts: [{ name: 'Rui', holderId: 'h1' }],
    });
  });

  it('makes a term deposit EUR and capitalizes when no account receives the interest', () => {
    const term = {
      ...emptyAccountForm('term_deposit'),
      name: 'DP',
      holderIds: ['h1'],
      currency: 'USD',
      rate: '2,5',
      capital: '5000',
      start: '2026-01-10',
      payN: '3',
      termN: '12',
    };
    expect(accountBody(term, 'create')).toMatchObject({ currency: 'EUR', rate: '2.5' });
    expect(depositBody(term)).toMatchObject({
      capital: '5000',
      rate: '2.5',
      payN: 3,
      payU: 'm',
      termN: 12,
      termU: 'm',
      capitalize: true,
      payToAccountId: null,
      tax: '28',
    });
    expect(depositBody({ ...term, payToAccountId: 'a1' })).toMatchObject({
      capitalize: false,
      payToAccountId: 'a1',
    });
  });

  it('names a deposit after its product and start date', () => {
    expect(defaultDepositName('DP BPI', '10/01/2026')).toBe('DP BPI · 10/01/2026');
    expect(defaultDepositName(undefined, '10/01/2026')).toBe('10/01/2026');
  });
});

describe('product and interest forms', () => {
  it('needs a name and a rate', () => {
    expect(validateProduct(emptyProductForm())).toEqual({ name: 'required', rate: 'required' });
    expect(validateProduct({ ...emptyProductForm(), name: 'DP', rate: '2,5' })).toEqual({});
  });

  it('sends no period unit when the period is empty', () => {
    const body = productBody({
      ...emptyProductForm(),
      name: 'DP',
      rate: '2,5',
      payN: '',
      termN: '',
    });
    expect(body).toMatchObject({ payN: null, payU: null, termN: null, termU: null, rate: '2.5' });
  });

  it('checks the interest entry', () => {
    expect(validateInterest({ date: '', amount: '' })).toEqual({
      date: 'required',
      amount: 'required',
    });
    expect(validateInterest({ date: '2026-03-01', amount: '0' }).amount).toBe('invalid');
    expect(interestBody('a1', { date: '2026-03-01', amount: '11,76' })).toEqual({
      accountId: 'a1',
      date: '2026-03-01',
      amount: '11.76',
    });
  });

  it('keeps the first segment of a server issue path', () => {
    expect(serverFields(['iban', 'subAccounts.0.name'])).toEqual(new Set(['iban', 'subAccounts']));
  });
});
