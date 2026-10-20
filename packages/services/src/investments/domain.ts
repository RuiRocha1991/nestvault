import type { InvestmentOpRow, PortfolioCashMoveRow } from '@nestvault/db';
import type { InvestmentOp, PortfolioCashMove } from '@nestvault/domain';

/** A stored operation as the domain's position and cash engines read it. */
export const toInvestmentOp = (row: InvestmentOpRow): InvestmentOp => ({
  id: row.id,
  date: row.date,
  assetId: row.assetId,
  type: row.type === 'dividend' ? 'div' : (row.type as 'buy' | 'sell'),
  portfolioId: row.portfolioId,
  accountId: row.accountId,
  subAccountId: row.subAccountId,
  fromCash: row.fromCash,
  qty: row.qty,
  price: row.price,
  fee: row.fee,
  amount: row.amount,
  gross: row.gross,
  tax: row.tax,
});

/** A stored cash move as the domain's portfolio cash reads it (signed, in EUR). */
export const toCashMove = (row: PortfolioCashMoveRow): PortfolioCashMove => ({
  portfolioId: row.portfolioId,
  date: row.date,
  amount: row.amount,
});
