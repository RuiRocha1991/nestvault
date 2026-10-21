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
