import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';

import type { AppDb, PoolTx } from '../client';
import { indexRates, type IndexRateRow } from '../schema/index-rates';

export type { IndexRateRow };

export interface IndexRateValues {
  rateIndex: string;
  /** First day of the month. */
  period: string;
  rate: string;
  source: string;
}

/**
 * The Euribor by month. Global: no pool. `app_rw` only reads it; the worker's monthly job writes it
 * with `upsertMany`, so a pool cannot alter a rate another pool reads.
 */
export const indexRatesRepo = {
  /** The newest month known for an index, or `undefined` before the first run of the job. */
  async latest(tx: PoolTx, rateIndex: string): Promise<IndexRateRow | undefined> {
    const [row] = await tx
      .select()
      .from(indexRates)
      .where(eq(indexRates.rateIndex, rateIndex))
      .orderBy(desc(indexRates.period))
      .limit(1);
    return row;
  },

  /** The months of an index from `from` on (`yyyy-mm-dd`), oldest first. */
  async list(tx: PoolTx, rateIndex: string, from: string): Promise<IndexRateRow[]> {
    return tx
      .select()
      .from(indexRates)
      .where(and(eq(indexRates.rateIndex, rateIndex), gte(indexRates.period, from)))
      .orderBy(asc(indexRates.period));
  },

  /** Inserts or corrects months. Running it twice with the same rows changes nothing. */
  async upsertMany(db: Pick<AppDb, 'insert'>, rows: readonly IndexRateValues[]): Promise<void> {
    if (rows.length === 0) return;
    await db
      .insert(indexRates)
      .values([...rows])
      .onConflictDoUpdate({
        target: [indexRates.rateIndex, indexRates.period],
        set: { rate: sql`excluded.rate`, source: sql`excluded.source`, fetchedAt: sql`now()` },
      });
  },
};
