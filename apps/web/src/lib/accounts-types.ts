import type {
  AccountCardDto,
  AccountsScreenDto,
  BrokerageDto,
  PortfolioDto,
  ProductDto,
  TermDepositDto,
} from '@nestvault/services';

// The shapes the accounts screen receives. Client components import these names from here, never
// the services root (a lint rule keeps server code out of the browser bundle).
export type AccountCard = AccountCardDto;
export type AccountsScreenData = AccountsScreenDto;
export type BrokerageFigures = BrokerageDto;
export type TermDeposit = TermDepositDto;
export type PortfolioOption = PortfolioDto;
export type SavingsProduct = ProductDto;
