import type {
  AccountDto,
  AssetDto,
  HoldingDto,
  PlanDto,
  PortfolioDto,
  PortfolioSummaryDto,
  PortfolioViewDto,
  ViewOpDto,
} from '@nestvault/services';

/** What the Portfolios screen receives from the server; client components import these. */
export type AccountView = AccountDto;
export type AssetView = AssetDto;
export type HoldingView = HoldingDto;
export type PlanView = PlanDto;
export type PortfolioView = PortfolioDto;
export type SummaryView = PortfolioSummaryDto;
export type PortfolioData = PortfolioViewDto;
export type OpView = ViewOpDto;

/** One linked account of the summary table (amounts as decimal strings). */
export interface LinkedAccountRow {
  id: string;
  name: string;
  institution: string | null;
  type: 'checking' | 'savings' | 'term_deposit' | 'brokerage';
  currency: string;
  /** Applications with the same group name share a row in the grouped view. */
  groupName: string | null;
  holderIds: readonly string[];
  /** Annual rate in percent. */
  rate: string | null;
  /** Start date of a term deposit. */
  since: string | null;
  /** In the account's currency, and in the currency of the portfolio figures. */
  balance: string;
  balanceDisplay: string;
  /** Net interest of the last 12 months (null for a term deposit) and in total. */
  interest12: string | null;
  interest12Display: string | null;
  interestTotal: string;
  interestTotalDisplay: string;
}
