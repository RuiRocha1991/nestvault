// What the Despesas screen reads from the API. Client components cannot import the services root,
// so these views mirror the DTOs they receive (`CategoryDto`, `TransactionDto`, ...); the page
// passes the DTOs as they are and TypeScript checks that they fit.

export type CategoryKind = 'expense' | 'income' | 'refund' | 'transfer' | 'invest';

export interface CategoryView {
  id: string;
  systemKey: string | null;
  name: string | null;
  kind: CategoryKind;
  color: string;
  colorOverride: string | null;
  global: boolean;
  monthlyBudget: string | null;
  hidden: boolean;
}

export interface AccountView {
  id: string;
  name: string;
  currency: string;
  holderIds: readonly string[];
}

export interface HolderNameView {
  id: string;
  name: string;
  userId: string | null;
}

export interface TransactionView {
  id: string;
  accountId: string;
  date: string;
  description: string;
  amount: string;
  categoryId: string | null;
  kind: CategoryKind;
  transfer: boolean;
  pairId: string | null;
  transferLocked: boolean;
  manualCategory: boolean;
  depositInterest: boolean;
  note: string | null;
  noteUpdatedBy: string | null;
  noteUpdatedAt: string | null;
  suggestedKeyword: string;
}

export interface TotalsView {
  income: string;
  expenses: string;
  invested: string;
  transfers: string;
  uncategorized: number;
  count: number;
  rates: Readonly<Record<string, string>>;
}

export interface RuleView {
  id: string;
  keyword: string;
  categoryId: string;
  accountId: string | null;
  position: number;
}

export interface UsageView {
  categories: Readonly<Record<string, number>>;
  rules: Readonly<Record<string, number>>;
}

export interface CategorySpendView {
  categoryId: string | null;
  value: string;
  budget: string | null;
  budgetUsed: string | null;
  previousAverage: string;
  difference: string;
}

export interface SummaryView {
  month: string;
  flow: {
    income: string;
    expenses: string;
    refunds: string;
    invested: string;
    savings: string;
    savingsRate: string | null;
  };
  categories: readonly CategorySpendView[];
  history: readonly { month: string; income: string; expenses: string }[];
}

export interface ApplyRulesView {
  matched: number;
  changed: number;
  applied: boolean;
  changes: readonly {
    transactionId: string;
    description: string;
    fromCategoryId: string | null;
    toCategoryId: string;
    transfer: boolean | null;
  }[];
}
