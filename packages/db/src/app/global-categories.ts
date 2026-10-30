/**
 * The default categories of every pool (ADR 0004), taken from the prototype's `defaultCategories`.
 * They live once, as global rows (`pool_id` null) written by the migration that creates the table;
 * the display name of each comes from i18n (`categories.<systemKey>`), so renaming one in
 * `pt-PT.json` renames it for every pool. Logic uses `systemKey` and `kind`, never the name. A test
 * compares this list with the rows the migration inserted.
 */
export const GLOBAL_CATEGORY_KINDS = ['expense', 'income', 'refund', 'transfer', 'invest'] as const;
export type GlobalCategoryKind = (typeof GLOBAL_CATEGORY_KINDS)[number];

export interface GlobalCategorySeed {
  systemKey: string;
  kind: GlobalCategoryKind;
  color: string;
}

export const GLOBAL_CATEGORIES: readonly GlobalCategorySeed[] = [
  { systemKey: 'housing', kind: 'expense', color: '#6C5CFF' },
  { systemKey: 'groceries', kind: 'expense', color: '#F2913D' },
  { systemKey: 'dining', kind: 'expense', color: '#E356A8' },
  { systemKey: 'transport', kind: 'expense', color: '#3BA7F2' },
  { systemKey: 'fuel', kind: 'expense', color: '#5B8DEF' },
  { systemKey: 'utilities', kind: 'expense', color: '#F2C43D' },
  { systemKey: 'telecoms', kind: 'expense', color: '#2BC6B4' },
  { systemKey: 'subscriptions', kind: 'expense', color: '#9D6BFF' },
  { systemKey: 'health', kind: 'expense', color: '#3CCB7F' },
  { systemKey: 'education', kind: 'expense', color: '#FF7A59' },
  { systemKey: 'insurance', kind: 'expense', color: '#8C8FB8' },
  { systemKey: 'shopping', kind: 'expense', color: '#E5424D' },
  { systemKey: 'leisure-travel', kind: 'expense', color: '#F2913D' },
  { systemKey: 'sports', kind: 'expense', color: '#3CCB7F' },
  { systemKey: 'taxes', kind: 'expense', color: '#8C8FB8' },
  { systemKey: 'cash-withdrawals', kind: 'expense', color: '#C9A227' },
  { systemKey: 'bank-fees', kind: 'expense', color: '#7779A6' },
  { systemKey: 'other-expenses', kind: 'expense', color: '#8C8FB8' },
  { systemKey: 'salary', kind: 'income', color: '#3CCB7F' },
  { systemKey: 'interest', kind: 'income', color: '#2BC6B4' },
  { systemKey: 'other-income', kind: 'income', color: '#3BA7F2' },
  { systemKey: 'external-transfers', kind: 'expense', color: '#C9A227' },
  { systemKey: 'refunds', kind: 'refund', color: '#2BC6B4' },
  { systemKey: 'internal-transfer', kind: 'transfer', color: '#7779A6' },
  { systemKey: 'investment', kind: 'invest', color: '#9D6BFF' },
  { systemKey: 'works', kind: 'expense', color: '#C9A227' },
];
