import { fxRatesRepo, poolSettingsRepo, type PoolContext, type PoolTx } from '@nestvault/db';
import { resolveFxRates, type MarketFxRate, type ResolvedFxRate } from '@nestvault/domain';

const MARKET_SOURCES = new Set(['seed', 'ecb', 'manual']);

/**
 * The rates a pool uses on `asOf` (`yyyy-mm-dd`): the pool's own override, else the newest market
 * rate dated on or before that day, else the seed constant. Inside `withPool`, so the override read
 * is the caller's pool only; other services (accounts, portfolios) call it for their EUR totals.
 */
export async function loadFxRates(
  tx: PoolTx,
  ctx: PoolContext,
  asOf: string,
): Promise<ResolvedFxRate[]> {
  const [market, settings] = await Promise.all([
    fxRatesRepo.latestAsOf(tx, asOf),
    poolSettingsRepo.find(tx, ctx),
  ]);
  return resolveFxRates({
    market: market.flatMap((row): MarketFxRate[] =>
      MARKET_SOURCES.has(row.source)
        ? [
            {
              currency: row.ccy,
              rate: row.eurRate,
              date: row.date,
              source: row.source as MarketFxRate['source'],
            },
          ]
        : [],
    ),
    overrides: settings?.fxOverrides ?? {},
  });
}
