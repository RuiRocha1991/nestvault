import type { AccountRow } from '@nestvault/db';
import type { LedgerAccount } from '@nestvault/domain';

const kindOf = (type: string): LedgerAccount['kind'] =>
  type === 'term_deposit' ? 'term' : type === 'savings' ? 'savings' : 'other';

/** An account row as the domain's balance engine reads it (shared by accounts and portfolios). */
export const toLedgerAccount = (row: AccountRow): LedgerAccount => ({
  id: row.id,
  currency: row.currency,
  kind: kindOf(row.type),
  isBrokerage: row.type === 'brokerage',
  trackCash: row.trackCash,
  opening: row.opening,
  openingDate: row.openingDate,
  portfolioId: row.portfolioId,
});
