import { describe, expect, it } from 'vitest';

import {
  applyRules,
  matchesKeyword,
  previewRules,
  suggestKeyword,
  type Category,
  type RuleContext,
  type Transaction,
} from '@nestvault/domain';

const categories: Category[] = [
  { id: 'sports', kind: 'expense' },
  { id: 'fuel', kind: 'expense' },
  { id: 'transfer', kind: 'transfer' },
  { id: 'external', kind: 'expense', systemKey: 'external-transfers' },
  { id: 'other', kind: 'expense', systemKey: 'other-expenses' },
  { id: 'refund', kind: 'refund' },
];
const OWN_IBAN = 'PT50000700000011122233344';
const context: RuleContext = {
  accounts: [
    { id: 'main', iban: 'PT50 0035 0000 1234 5678 9012 3' },
    { id: 'savings', iban: OWN_IBAN },
  ],
  categories,
  rules: [
    { id: 'r-trainer', keyword: 'PT50003501350069602273023', categoryId: 'sports' },
    { id: 'r-fuel', keyword: 'repsol', categoryId: 'fuel' },
    { id: 'r-fuel-savings', keyword: 'galp', categoryId: 'fuel', accountId: 'savings' },
    { id: 'r-late', keyword: 'repsol', categoryId: 'sports' },
  ],
  holderAliases: ['Maria Silva', 'JO'],
};

let seq = 0;
const tx = (partial: Partial<Transaction> & Pick<Transaction, 'description'>): Transaction => ({
  id: `t${++seq}`,
  accountId: 'main',
  date: '2026-09-01',
  amount: '-30',
  ...partial,
});

describe('applyRules', () => {
  it('rule on an IBAN categorizes the personal trainer transfer', () => {
    const result = applyRules(
      tx({ description: 'TRF P/ PT50003501350069602273023 PERSONAL TRAINER' }),
      context,
    );
    expect(result).toEqual({
      categoryId: 'sports',
      transfer: false,
      reason: 'rule',
      ruleId: 'r-trainer',
    });
  });

  it('matches a keyword at the start of a word only', () => {
    expect(applyRules(tx({ description: 'COMPRA REPSOL LISBOA' }), context)?.categoryId).toBe(
      'fuel',
    );
    expect(applyRules(tx({ description: 'COMPRA XREPSOL LISBOA' }), context)).toBeNull();
    expect(matchesKeyword('Compra repsol lisboa', 'REPSOL')).toBe(true);
    expect(matchesKeyword('COMPRA 9REPSOL', 'REPSOL')).toBe(false);
    expect(matchesKeyword('REPSOL', '')).toBe(false);
  });

  it('matches again after a failed first hit inside a word', () => {
    expect(matchesKeyword('XREPSOL E REPSOL', 'REPSOL')).toBe(true);
  });

  it('ignores accents and case, and uses the first rule by position', () => {
    expect(applyRules(tx({ description: 'Compra Répsol' }), context)).toMatchObject({
      categoryId: 'fuel',
      ruleId: 'r-fuel',
    });
  });

  it('restricts a rule to its account', () => {
    expect(applyRules(tx({ description: 'GALP BOMBA' }), context)).toBeNull();
    expect(
      applyRules(tx({ description: 'GALP BOMBA', accountId: 'savings' }), context)?.categoryId,
    ).toBe('fuel');
  });

  it('never overrides a manual category unless forced', () => {
    const manual = tx({ description: 'COMPRA REPSOL', manualCategory: true });
    expect(applyRules(manual, context)).toBeNull();
    expect(applyRules(manual, context, { force: true })?.categoryId).toBe('fuel');
  });

  it('a transfer to the IBAN of another own account is an internal transfer', () => {
    const result = applyRules(tx({ description: `TRF PARA ${OWN_IBAN} POUPANCA` }), context);
    expect(result).toEqual({ categoryId: 'transfer', transfer: true, reason: 'own-iban' });
    const locked = applyRules(
      tx({ description: `TRF ${OWN_IBAN}`, transferLocked: true }),
      context,
    );
    expect(locked).toMatchObject({ categoryId: 'transfer', transfer: null });
  });

  it('ignores the IBAN of the account itself and descriptions that are not transfers', () => {
    expect(
      applyRules(tx({ description: `TRF ${OWN_IBAN}`, accountId: 'savings' }), context),
    ).toBeNull();
    expect(applyRules(tx({ description: `COMPRA ${OWN_IBAN}` }), context)).toBeNull();
  });

  it('a household alias: outflow is an expense sent outside the app, inflow a refund', () => {
    const out = applyRules(tx({ description: 'TRF MARIA SILVA' }), context);
    expect(out).toEqual({ categoryId: 'external', transfer: false, reason: 'holder-alias' });
    const inn = applyRules(tx({ description: 'TRF MARIA SILVA', amount: '30' }), context);
    expect(inn).toMatchObject({ categoryId: 'refund', transfer: false });
    expect(applyRules(tx({ description: 'TRF MARIA SILVA', pairId: 'p' }), context)).toMatchObject({
      transfer: null,
    });
  });

  it('falls back to "other expenses" when there is no external-transfers category, and skips short aliases', () => {
    const noExternal = { ...context, categories: categories.filter((c) => c.id !== 'external') };
    expect(applyRules(tx({ description: 'TRF MARIA SILVA' }), noExternal)?.categoryId).toBe(
      'other',
    );
    expect(applyRules(tx({ description: 'TRF JO' }), context)).toBeNull();
  });

  it('marks the transfer flag from the rule category kind', () => {
    const toTransfer = {
      ...context,
      rules: [{ id: 'r', keyword: 'POUPANCA', categoryId: 'transfer' }],
    };
    expect(applyRules(tx({ description: 'POUPANCA MENSAL' }), toTransfer)?.transfer).toBe(true);
    expect(
      applyRules(tx({ description: 'POUPANCA', transferLocked: true }), toTransfer)?.transfer,
    ).toBeNull();
  });
});

describe('suggestKeyword', () => {
  it('prefers the IBAN', () => {
    expect(suggestKeyword('01/09 TRF P/ PT50003501350069602273023 João')).toBe(
      'PT50003501350069602273023',
    );
  });

  it('otherwise keeps the first two meaningful words', () => {
    expect(suggestKeyword('COMPRA REPSOL LISBOA 12345')).toBe('REPSOL LISBOA');
    expect(suggestKeyword('02/09 PAGAMENTO DD EDP COMERCIAL SA')).toBe('EDP COMERCIAL');
    expect(suggestKeyword('Compra Pingo Doce Cascais')).toBe('PINGO DOCE');
    expect(suggestKeyword('')).toBe('');
  });
});

describe('previewRules', () => {
  it('lists what the rules would do without applying it', () => {
    const txs = [
      tx({ id: 'new', description: 'COMPRA REPSOL' }),
      tx({ id: 'same', description: 'COMPRA REPSOL', categoryId: 'fuel' }),
      tx({ id: 'manual', description: 'COMPRA REPSOL', manualCategory: true }),
      tx({ id: 'none', description: 'MERCEARIA' }),
    ];
    const preview = previewRules(txs, context);
    expect(
      preview.map((c) => [c.transactionId, c.fromCategoryId, c.result.categoryId, c.changed]),
    ).toEqual([
      ['new', null, 'fuel', true],
      ['same', 'fuel', 'fuel', false],
    ]);
    expect(txs[0]?.categoryId).toBeUndefined();
  });

  it('flags a change of the transfer flag even when the category stays', () => {
    const toTransfer = {
      ...context,
      rules: [{ id: 'r', keyword: 'POUPANCA', categoryId: 'transfer' }],
    };
    const [change] = previewRules(
      [tx({ description: 'POUPANCA', categoryId: 'transfer', transfer: false })],
      toTransfer,
    );
    expect(change?.changed).toBe(true);
  });
});
