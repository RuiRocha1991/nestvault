import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { applyRules, type Category, type RuleContext, type Transaction } from '@nestvault/domain';

// The rows `services/parser` returns for the anonymized BPI statement (tests/fixtures/bpi).
interface ExpectedRow {
  date: string;
  description: string;
  amount: string;
}
const expected = JSON.parse(
  readFileSync(new URL('../fixtures/bpi/bpi-movimentos.expected.json', import.meta.url), 'utf-8'),
) as { rows: ExpectedRow[]; meta: { closing_balance: string } };

const categories: Category[] = [
  { id: 'sports', kind: 'expense' },
  { id: 'fuel', kind: 'expense' },
  { id: 'transfer', kind: 'transfer' },
  { id: 'external', kind: 'expense', systemKey: 'external-transfers' },
  { id: 'other', kind: 'expense', systemKey: 'other-expenses' },
  { id: 'refund', kind: 'refund' },
];
const context: RuleContext = {
  accounts: [
    { id: 'main', iban: 'PT50 0035 0000 1234 5678 9012 3' },
    { id: 'savings', iban: 'PT50000700000011122233344' },
  ],
  categories,
  rules: [
    { id: 'r-trainer', keyword: 'PT50003501350069602273023', categoryId: 'sports' },
    { id: 'r-fuel', keyword: 'repsol', categoryId: 'fuel' },
  ],
  holderAliases: ['Ana Exemplo'],
};

const categorize = (row: ExpectedRow) =>
  applyRules(
    {
      id: row.description,
      accountId: 'main',
      date: row.date,
      amount: row.amount,
      description: row.description,
    } satisfies Transaction,
    context,
  );

const byDescription = (part: string) => {
  const row = expected.rows.find((entry) => entry.description.includes(part));
  if (!row) throw new Error(`No fixture row with ${part}`);
  return categorize(row);
};

describe('prototype rules on the anonymized BPI statement', () => {
  it('reads the statement the parser produced', () => {
    expect(expected.rows).toHaveLength(26);
    expect(expected.meta.closing_balance).toBe('3959.43');
  });

  it('puts the personal trainer IBAN under sports', () => {
    expect(byDescription('PT50003501350069602273023')).toMatchObject({
      categoryId: 'sports',
      reason: 'rule',
    });
  });

  it('puts the fuel purchase under fuel', () => {
    expect(byDescription('REPSOL')).toMatchObject({ categoryId: 'fuel', reason: 'rule' });
  });

  it('makes a transfer to the own savings IBAN an internal transfer', () => {
    expect(byDescription('PT50000700000011122233344')).toMatchObject({
      categoryId: 'transfer',
      transfer: true,
      reason: 'own-iban',
    });
  });

  it('treats a transfer from a household member as a refund', () => {
    expect(byDescription('DE ANA EXEMPLO')).toMatchObject({
      categoryId: 'refund',
      reason: 'holder-alias',
    });
  });

  it('leaves everything the rules do not know uncategorized', () => {
    expect(byDescription('SUPERMERCADO')).toBeNull();
    expect(byDescription('JUROS DE EMPRESTIMO')).toBeNull();
  });
});
