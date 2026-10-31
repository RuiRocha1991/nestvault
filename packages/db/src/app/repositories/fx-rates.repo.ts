import { asc, desc, lte, sql } from 'drizzle-orm';

import type { AppDb, PoolTx } from '../client';
import { fxRates } from '../schema/fx-rates';

export interface MarketRate {
  ccy: string;
  eurRate: string;
  date: string;
  source: string;
}

/**
 * The global rates. `app_rw` has no write privilege on `fx_rates`: the web app only reads it
 * (`latestAsOf`); the worker's daily `fx.refresh` job writes it with `upsertMany`.
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

  /**
   * Inserts or corrects rates. Running it twice with the same rows changes nothing, and a rate
   * someone entered by hand (`manual`) is never overwritten.
   */
  async upsertMany(db: Pick<AppDb, 'insert'>, rows: readonly MarketRate[]): Promise<void> {
    if (rows.length === 0) return;
    await db
      .insert(fxRates)
      .values([...rows])
      .onConflictDoUpdate({
        target: [fxRates.date, fxRates.ccy],
        set: { eurRate: sql`excluded.eur_rate`, source: sql`excluded.source` },
        setWhere: sql`${fxRates.source} <> 'manual'`,
      });
  },
};
