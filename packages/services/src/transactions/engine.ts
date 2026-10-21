import {
  accountsRepo,
  categoriesRepo,
  categoryRulesRepo,
  holdersRepo,
  poolSettingsRepo,
  type EngineTransaction,
  type PoolContext,
  type PoolTx,
} from '@nestvault/db';
import type {
  Category,
  CategoryKind,
  RuleContext,
  Transaction,
  TransferAccount,
} from '@nestvault/domain';

/** Everything the domain's rules and transfer detection read for one pool. */
export interface EngineContext {
  rules: RuleContext;
  categories: readonly Category[];
  transferAccounts: readonly TransferAccount[];
  /** The pool's transfer window in days. */
  days: number;
}

const DEFAULT_WINDOW_DAYS = 3;

export async function loadEngineContext(tx: PoolTx, ctx: PoolContext): Promise<EngineContext> {
  const [categoryRows, rules, accountRows, holderRows, settings] = await Promise.all([
    categoriesRepo.list(tx, ctx),
    categoryRulesRepo.list(tx, ctx),
    accountsRepo.list(tx, ctx),
    holdersRepo.list(tx, ctx),
    poolSettingsRepo.find(tx, ctx),
  ]);
  const categories = categoryRows.map((row): Category => ({
    id: row.id,
    kind: row.kind as CategoryKind,
    systemKey: row.systemKey,
  }));
  return {
    categories,
    days: settings?.transferWindowDays ?? DEFAULT_WINDOW_DAYS,
    transferAccounts: accountRows.map((row) => ({
      id: row.id,
      currency: row.currency,
      isBrokerage: row.type === 'brokerage',
    })),
    rules: {
      accounts: accountRows.map((row) => ({ id: row.id, iban: row.iban })),
      categories,
      rules: rules.map((rule) => ({
        id: rule.id,
        keyword: rule.keyword,
        categoryId: rule.categoryId,
        accountId: rule.accountId,
      })),
      // Aliases are how the people appear in bank descriptions (the holder dialog says so).
      holderAliases: holderRows.flatMap((holder) => holder.aliases),
    },
  };
}

/** A stored movement as the domain engine reads it. */
export const toEngineTransaction = (row: EngineTransaction): Transaction => ({
  id: row.id,
  accountId: row.accountId,
  date: row.date,
  amount: row.amount,
  description: row.description,
  categoryId: row.categoryId,
  manualCategory: row.manualCategory,
  transfer: row.transfer,
  pairId: row.pairId,
  transferLocked: row.transferLocked,
  depositInterest: row.depositInterest,
});
