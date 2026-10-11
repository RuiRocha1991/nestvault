# ADR 0002 — Market data behind swappable providers (free first, paid later)

- **Status:** Accepted (design). Implementation in phase 3 (worker epic NES-8).
- **Date:** 2026-10-11

## Context

The app needs, for every asset held by any pool: current prices (hourly in market hours), dividend
events (amount, ex-date, record date, pay date) and a forecast of future dividends. European
coverage matters (Euronext Lisbon, ETFs listed in Amsterdam/Xetra/Milan, US stocks via XTB).

Constraints:
- Start with **free** data sources while the app is personal / has no paying users.
- Free tiers change often, have small quotas (e.g. ~25 requests/day for Alpha Vantage, ~250/day
  for FMP, ~800/day for Twelve Data at the time of writing — verify before use), weak European
  dividend coverage, and frequently **forbid commercial use**.
- When paying users arrive, switching to a paid provider (EODHD, FMP paid, Twelve Data Grow,
  Eulerpool…) must be a configuration change plus one adapter, not a refactor.
- Investment funds / PPR (e.g. Banco Invest) usually have no API at all.

## Decision

1. **One interface, several adapters.** `packages/market-data` defines:
   ```ts
   interface MarketDataProvider {
     id: string;                                   // 'twelvedata' | 'alphavantage' | 'eulerpool' | 'manual' | …
     capabilities: Set<'quote' | 'history' | 'dividends' | 'search'>;
     quotes(symbols: ProviderSymbol[]): Promise<Quote[]>;           // batched when supported
     history(symbol: ProviderSymbol, from: IsoDate): Promise<PricePoint[]>;
     dividends(symbol: ProviderSymbol, from: IsoDate): Promise<DividendEvent[]>;
     search(query: string): Promise<InstrumentMatch[]>;
   }
   ```
   Every adapter validates responses with zod and maps them to our types. Adapters are tested with
   recorded fixtures only (no network in CI).
2. **Routing by capability, configured by env**: `MARKET_PRICES_PROVIDERS=twelvedata,alphavantage`,
   `MARKET_DIVIDENDS_PROVIDERS=eulerpool,alphavantage` — an ordered fallback chain per capability.
   Switching provider = add the adapter, change the env var, run the backfill command.
3. **Global market tables** in `nestvault_app` (no `pool_id`, read-only for `app_rw`, written only by
   the worker's market-data role): `market_instruments` (isin, name, type, ccy, exchange),
   `market_symbols` (instrument_id, provider_id, symbol — per-provider symbol mapping),
   `market_prices` (instrument_id, date, close, source), `market_dividends` (instrument_id,
   ex_date, record_date, pay_date, amount, ccy, kind announced|paid, source). Pool `assets` link to an
   instrument (`assets.instrument_id`, optional). One fetch per instrument for the whole app.
4. **Quota manager**: per-provider token bucket (per minute and per day) persisted in Postgres;
   symbols prioritized by number of pools holding them and staleness; when the quota runs out, the
   job stops and resumes next window — never hammer a provider.
5. **Jobs**: `prices.refresh` hourly 08:00–22:00 on business days (unchanged, NES-66);
   `dividends.refresh` **daily** (corporate actions change at most daily — hourly would waste quota);
   `instruments.sync` on demand when a new asset is added (search + symbol mapping).
6. **Forecast when nothing is announced**: domain function projects the next 12 months from the
   paid history (frequency detected from intervals, last amount, same months), marked
   `estimated`. Announced events always win. Expected cash per holding = quantity held at ex-date ×
   amount × (1 − withholding rate).
7. **Manual / own sources as first-class providers**: `manual` (user-entered prices and dividends),
   `statements` (dividends parsed from XTB/Trade Republic imports confirm and correct
   estimates), and optional `fund-nav` scrapers per fund manager page (isolated, rate-limited,
   one adapter per site).
8. **Licensing gate**: each adapter declares `commercialUse: boolean`. A startup check refuses a
   non-commercial provider when `BILLING_ENABLED=true` — the switch to paid plans forces the switch
   to a licensed provider.

## Consequences

- Free sources work for the family now; quality improves with announced data when a better
  provider is plugged in.
- Some European dividends will be estimates or come from statements until a paid provider is used.
- Extra tables and a quota manager to maintain.
