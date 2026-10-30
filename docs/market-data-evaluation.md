# Market data provider evaluation (NES-91)

Input to ADR 0002 and to NES-92 (market data layer). Date of research: **2026-10-28**.

## Method and limits

Desk research on the providers' public pricing and documentation pages. **No API keys were used and
no live calls were made**, so latency and per-ISIN coverage are _not measured_. Anything marked
**(verify)** must be confirmed with a free key before an adapter is written (a 30-minute check per
provider). Free tiers change often: re-check quotas and terms when NES-92 starts.

Where a provider's page did not state something (commercial terms, endpoint availability on the
free plan), this document says so instead of guessing. FMP's pricing and FAQ pages returned HTTP 403
to the research tool, so its row relies on third-party summaries and is the least reliable.

## Instruments held

The prototype export (`tests/fixtures/prototype-export.anonymized.json`) has only four assets:

| Ticker | Type | Currency | Notes |
| --- | --- | --- | --- |
| VWCE | ETF | EUR | accumulating ETF, no dividends |
| AAPL | Ação | USD | pays dividends (XTB statements) |
| PPR-AC | PPR | EUR | no listing, no API |
| IBM (test) | Ação | USD | fixture entry |

It has no Euronext Lisbon stock and no crypto. The matrix therefore adds a **representative set**
(marked ◇, hypothetical) to cover every asset class the app supports: a PSI stock (e.g. EDP), an
Amsterdam/Xetra-listed ETF with distributions, a REIT (O), a bond ETF, BTC and ETH.

## Providers

| Provider | Free quota | Batching | Dividends | EU coverage on free | ISIN lookup | Commercial use |
| --- | --- | --- | --- | --- | --- | --- |
| **Twelve Data** (Basic) | 8 credits/min, 800/day | credits are charged per symbol, so batching saves requests, not credits | listed as a feature; free-plan availability **(verify)** | free plan lists 3 exchanges (US equities/ETFs, forex, crypto); EU real-time is Pro | search by symbol/name; ISIN **(verify)** | Basic is "for testing and side projects"; business terms are on a separate page: **no** for the app once billing is on |
| **Alpha Vantage** (free) | **25 requests/day** | free: one symbol per request (bulk quotes are premium) | `DIVIDENDS` endpoint exists | symbol suffixes `.LON`, `.DEX`, `.TRV`…; `.AMS` not confirmed | `SYMBOL_SEARCH` by keywords | not stated on the pricing page; read the ToS **(verify)** |
| **FMP** (Basic) | 250 requests/day (third-party sources) | n/a | not confirmed on free | third-party summary says "sample tickers only"; US-only on the next tier **(verify)** | n/a | third-party sources say free is non-commercial **(verify)** |
| **Eulerpool** (API) | 100 000 requests/month (vendor blog) | up to 100 symbols per request count as one | `/v1/dividends/{ticker}/history` with ex, record and pay dates (vendor blog) | "100 000+ securities, 90+ exchanges" (vendor claim, exchanges not named) | ticker, name, ISIN or CUSIP | not spelled out; presented as licensed for customer-facing products **(verify)** |
| **EODHD** (paid reference) | free: 20 calls/day (1 year of EOD) | n/a | EOD + dividends plan: 19,99 €/month, 100 000 calls/day | good, 30+ years of history | yes | separate commercial plans via sales |
| **CoinGecko** (Demo) | 100 calls/min, **10 000 calls/month** | `simple/price` accepts up to 515 ids in one call | n/a (crypto) | n/a | no ISIN; uses coin ids | Demo requires attribution ("Data provided by CoinGecko"); the Commercial licence is listed only for paid plans |

Eulerpool's figures come from its own marketing pages, which also describe its own "Terminal"
product plans (Free / Pro 41 $ per month); the API quota above is from the API blog. Treat it as
the most promising candidate and the least verified.

## Coverage matrix

`✓` = documented, `?` = to verify with a key, `✗` = not available on the free plan, `–` = not applicable.
Rows with ◇ are hypothetical instruments.

| Instrument | Capability | Twelve Data | Alpha Vantage | FMP | Eulerpool | CoinGecko |
| --- | --- | --- | --- | --- | --- | --- |
| AAPL (US stock) | quote | ✓ | ✓ (daily delayed) | ✓ | ? | – |
| AAPL | dividends | ? | ✓ | ? | ✓ | – |
| VWCE (Xetra ETF) | quote | ✗ (EU not on Basic) | ? (`.DEX`) | ✗ | ? | – |
| VWCE | dividends | – (accumulating) | – | – | – | – |
| ◇ EDP (Euronext Lisbon) | quote | ✗ | ? | ✗ | ? | – |
| ◇ EDP | dividends (ex/record/pay) | ✗ | ? | ✗ | ? | – |
| ◇ EU distributing ETF | dividends | ✗ | ? | ✗ | ? | – |
| ◇ REIT O (US) | quote, dividends | ✓ / ? | ✓ / ✓ | ✓ / ? | ? / ✓ | – |
| PPR-AC / funds | quote | ✗ | ✗ | ✗ | ✗ | – |
| ◇ BTC, ETH | quote | ✓ | ✓ (daily) | ? | ? (Pro tier) | ✓ |

Funds and the PPR have no listing on any of these, so no provider covers them.

## Daily request budget

Schedules from NES-66: markets hourly 08:00–22:00 Mon–Fri = **15 runs/day**; crypto every hour,
24/7 = **24 runs/day**; dividends once a day. N is the number of distinct instruments held by all
pools (the job fetches each instrument once, whatever the number of pools).

### Markets (stocks, ETFs, REITs, bonds), 15 runs/day

| Provider | Cost per run | Per day | Free quota | Max N within quota |
| --- | --- | --- | --- | --- |
| Twelve Data | N credits | 15·N | 800 / day | **≈ 53** |
| Alpha Vantage | N requests (no free batch) | 15·N | 25 / day | **1** (hourly is not viable) |
| FMP | N requests | 15·N | 250 / day | ≈ 16 |
| Eulerpool | 1 request per 100 symbols | 15·⌈N/100⌉ | ≈ 3 300 / day (100 000 / month) | very large |

Alpha Vantage cannot serve the hourly job even for a family portfolio; it only fits the daily
dividends job with rotation (25 instruments/day) or occasional `search` calls.

### Crypto, 24 runs/day

| Provider | Cost per run | Per month (30 days) | Free quota |
| --- | --- | --- | --- |
| CoinGecko | 1 request for up to 515 coins | 720 | 10 000 / month (7 % used) |
| Twelve Data | one credit per coin | 24·C·30 (C = coins) | 800 / day shared with markets |

Crypto on Twelve Data competes with markets for the same 800 credits, so CoinGecko should be its own
chain. At 24 requests/day it has a large margin even with several API keys unused.

### Dividends, 1 run/day

N requests per day with a per-instrument endpoint (Alpha Vantage: N ≤ 25; Eulerpool: negligible).

## Recommendation (to be confirmed with keys before NES-92)

```
MARKET_PRICES_PROVIDERS=eulerpool,twelvedata
MARKET_CRYPTO_PROVIDERS=coingecko
MARKET_DIVIDENDS_PROVIDERS=eulerpool,statements,alphavantage
```

- **Prices (markets):** Eulerpool first (quota and batching fit, European scope) with Twelve Data as
  fallback for US names. If Eulerpool fails the key check below, Twelve Data alone covers only US
  holdings: EU prices would then fall back to `manual` until a paid provider (EODHD at 19,99 €/month
  is the reference) is plugged in.
- **Crypto:** CoinGecko, a separate chain (`MARKET_CRYPTO_PROVIDERS` is a new variable, to add in
  NES-92 and ADR 0002) because ISIN does not apply and its quota is independent.
- **Dividends:** Eulerpool for announced events, `statements` (XTB / Trade Republic imports) to
  confirm paid amounts, Alpha Vantage as a rotating fallback within its 25/day.
- **Funds and PPR:** no API. Use `manual` prices first; add `fund-nav` adapters per manager page only
  for funds the family actually holds (one isolated, rate-limited adapter per site); statements fill
  in operations. A status of `no source` must never fail the job (NES-66).

## Licensing gate (ADR 0002 point 8)

Declared `commercialUse` for the adapters, until verified otherwise:

| Adapter | `commercialUse` | Reason |
| --- | --- | --- |
| `twelvedata` | `false` on Basic | "testing and side projects" |
| `alphavantage` | `false` | not stated, assume no |
| `fmp` | `false` | third-party reports non-commercial |
| `eulerpool` | unknown, set `false` until the ToS is read | not stated |
| `coingecko` | `false` on Demo | commercial licence only on paid plans; attribution required |
| `manual`, `statements` | `true` | our own data |

With `BILLING_ENABLED=true` the startup check will refuse every free provider, as designed: going
paid forces a licensed plan (EODHD or paid tiers of the same vendors).

## To verify with a free key (30 minutes each)

1. Eulerpool: free-plan quota, Euronext Lisbon and Xetra coverage by ISIN, dividends for a PSI stock
   and an EU distributing ETF, real terms for commercial use.
2. Twelve Data: whether `dividends` and `symbol_search` by ISIN work on Basic, and credit cost.
3. Alpha Vantage: `.AMS`/`.DEX` symbols for ETFs and the dividends payload fields.
4. FMP: free-plan exchanges and dividends access (its site blocks automated fetches).
5. CoinGecko: attribution requirement and real latency.

Keys go into `.env.local` only; none are in the repository.

## Sources

- Twelve Data pricing: https://twelvedata.com/pricing
- Alpha Vantage premium and documentation: https://www.alphavantage.co/premium/ , https://www.alphavantage.co/documentation/
- Eulerpool pricing and dividend API guide: https://eulerpool.com/en/pricing , https://eulerpool.com/blog/dividend-api
- EODHD pricing: https://eodhd.com/pricing
- CoinGecko pricing and `simple/price`: https://www.coingecko.com/en/api/pricing , https://docs.coingecko.com/reference/simple-price
- FMP plans (third-party summaries only): https://site.financialmodelingprep.com/pricing-plans
