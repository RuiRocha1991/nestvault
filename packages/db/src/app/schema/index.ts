// Tables of nestvault_app. Every one has `pool_id`, RLS and an isolation test: use the
// `db-migration` skill. `fx_rates` is the global exception (read-only for `app_rw`).
export { holders } from './holders';
export type { HolderRow } from './holders';
export { fxRates } from './fx-rates';
export type { FxRateRow } from './fx-rates';
export { poolSettings } from './pool-settings';
export type { PoolSettingsRow } from './pool-settings';
export { accountHolders, accounts, subAccounts } from './accounts';
export type { AccountHolderRow, AccountRow, SubAccountRow } from './accounts';
export { assetPrices, assets } from './assets';
export type { AssetPriceRow, AssetRow } from './assets';
export { categories, poolCategorySettings } from './categories';
export type { CategoryRow, CategorySettingsRow } from './categories';
export { categoryRules, transactions } from './transactions';
export type { CategoryRuleRow, TransactionRow } from './transactions';
export { portfolios } from './portfolios';
export type { PortfolioRow } from './portfolios';
export { investmentOps, plans } from './investments';
export type { InvestmentOpRow, PlanRow } from './investments';
export { monthNotes } from './notes';
export type { MonthNoteRow } from './notes';
export { deposits, interestEntries, savingsProducts } from './savings';
export type { DepositRow, InterestEntryRow, SavingsProductRow } from './savings';
