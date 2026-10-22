import type {
  AccountView,
  AssetView,
  LinkedAccountRow,
  PlanView,
  PortfolioData,
  PortfolioView,
  SummaryView,
} from '@webapp/lib/portfolios-types';
import type { CurrencyMode } from '@webapp/lib/portfolios-view';

export interface HolderName {
  id: string;
  name: string;
}

/** What the caller may do; the services enforce it, these only hide what would answer 403. */
export interface PortfolioPermissions {
  /** `ops.write`: record, change and delete operations and run plans. */
  ops: boolean;
  /** `portfolios.write`: portfolios, assets and plans. */
  portfolios: boolean;
  /** `notes.write`. */
  notes: boolean;
}

/** Everything the tabs of the Portfolios screen read. */
export interface TabContext {
  poolId: string;
  /** The portfolio of the URL; null for "Todos". */
  portfolioId: string | null;
  portfolios: readonly PortfolioView[];
  summary: SummaryView;
  data: PortfolioData;
  /** `?moeda=` of the URL, kept when the links of the screen change tab or portfolio. */
  currencyMode: CurrencyMode;
  /** The accounts linked to the scope, for the summary table. */
  linkedAccounts: readonly LinkedAccountRow[];
  assets: readonly AssetView[];
  assetsById: ReadonlyMap<string, AssetView>;
  accounts: readonly AccountView[];
  plans: readonly PlanView[];
  holders: readonly HolderName[];
  permissions: PortfolioPermissions;
}

/** The dialogs of the screen; each tab asks the screen to open one. */
export type DialogRequest =
  | { kind: 'op'; opId?: string; assetId?: string; type?: 'buy' | 'sell' | 'dividend' }
  | { kind: 'asset'; assetId?: string }
  | { kind: 'assetSheet'; assetId: string }
  | { kind: 'moveCash' }
  | { kind: 'portfolio'; portfolioId?: string }
  | { kind: 'plan'; planId?: string }
  | { kind: 'deleteOp'; opId: string }
  | { kind: 'deletePlan'; planId: string };

export type OpenDialog = (request: DialogRequest) => void;
