import { asc, desc, lte } from 'drizzle-orm';

import type { PoolTx } from '../client';
import { fxRates } from '../schema/fx-rates';

export interface MarketRate {
  ccy: string;
  eurRate: string;
  date: string;
  source: string;
}

/**
 * The global rates. Read only: `app_rw` has no write privilege on `fx_rates` (the migration seeds
 * it, a worker role fills it later), so there is no write function here.
 */
export const fxRatesRepo = {
  /** For each currency, the newest rate dated on or before `asOf` (`yyyy-mm-dd`). */
  async latestAsOf(tx: PoolTx, asOf: string): Promise<MarketRate[]> {
    return tx
      .selectDistinctOn([fxRates.ccy], {
        ccy: fxRates.ccy,
        eurRate: fxRates.eurRate,
        date: fxRates.date,
        source: fxRates.source,
      })
      .from(fxRates)
      .where(lte(fxRates.date, asOf))
      .orderBy(asc(fxRates.ccy), desc(fxRates.date));
  },
};
