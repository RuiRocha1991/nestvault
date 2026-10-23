// NES-8 — Phase 3: Worker and automation. Scope: only what this epic adds around apps/worker.
// Sources: Jira NES-8 and children NES-65..69, NES-91..93; docs/adr/0002-market-data-providers.md;
// docker-compose.yml (postgres, mailpit); apps/worker/ (skeleton only today).
workspace "NestVault — NES-8 Worker and automation" "Scheduled and on-demand jobs through the same service layer and guards" {

    model {
        owner = person "Pool owner" "Sees prices, FX, dividend calendar, snapshots, reminders and the last job runs"

        ecb = softwareSystem "ECB" "Daily euro reference rates (XML)" "External"
        marketProviders = softwareSystem "Market data providers" "Prices and dividends: free first (Twelve Data, Alpha Vantage, FMP, Eulerpool), paid later (EODHD). Final choice pending spike NES-91" "External"
        // assumed: ADR 0002 item 7 marks it optional
        fundPages = softwareSystem "Fund manager pages" "NAV of funds/PPR without API (optional fund-nav adapter)" "External"

        nestvault = softwareSystem "NestVault" "Family finance app" {
            web = container "Web app" "Next.js: pages, Server Actions, /api/v1; shows jobs results" "Next.js 15"
            worker = container "Worker" "pg-boss process: job registry, cron in Europe/Lisbon, retries, system actor per pool" "Node.js, pg-boss" {
                runtime = component "Job runtime" "Registry with zod payloads, cron, retry with backoff, singleton keys, graceful shutdown, structured logs" "pg-boss" "NES-65"
                systemCtx = component "System context" "systemContext(poolId): explicit permissions per job, one withPool per pool" "TypeScript" "NES-65"
                pricesJob = component "prices.refresh" "Hourly 08:00-22:00 Mon-Fri; one fetch per instrument for the whole app" "Job" "NES-66"
                fxJob = component "fx.refresh" "Daily 17:00; ECB XML parsed without external entities" "Job" "NES-67"
                dividendsJob = component "dividends.refresh" "Daily at night; announced and paid events into market_dividends" "Job" "NES-93"
                instrumentsJob = component "instruments.sync" "On demand when an asset is created or its ticker/ISIN changes" "Job" "NES-92"
                depositsJob = component "deposits.link" "After each import commit, per pool" "Job" "NES-68"
                remindJob = component "plans.remind" "Daily 09:00; in-app notification for missed regular investments" "Job" "NES-68"
                snapshotJob = component "snapshots.daily" "Daily 23:30; net worth per pool" "Job" "NES-69"
                cleanupJob = component "sessions.cleanup" "Daily; expired sessions, old invites, rate limits, discarded previews" "Job" "NES-69"
            }
            marketData = container "Market data layer" "MarketDataProvider interface, adapters, router by capability with env fallback chain, quota manager, symbol mapping" "TypeScript package packages/market-data" "NES-92"
            services = container "Services and domain" "Use cases, guards, linkDepositFlows, netWorth, forecastDividends" "TypeScript packages/services, packages/domain"
            appDb = container "App database" "Pool tables with RLS; global market_* tables (read-only for app_rw, written by market role); notifications; net_worth_snapshots; schema pgboss" "PostgreSQL 16" "Database"
        }

        owner -> web "Uses" "HTTPS"
        web -> services "Calls use cases" "in-process"
        web -> appDb "Enqueues on-demand jobs; reads last runs" "SQL via pg-boss"

        runtime -> appDb "Stores queues, schedules and runs" "SQL, schema pgboss"
        runtime -> pricesJob "Triggers on cron"
        runtime -> fxJob "Triggers on cron"
        runtime -> dividendsJob "Triggers on cron"
        runtime -> instrumentsJob "Triggers on demand"
        runtime -> depositsJob "Triggers after import"
        runtime -> remindJob "Triggers on cron"
        runtime -> snapshotJob "Triggers on cron"
        runtime -> cleanupJob "Triggers on cron"
        pricesJob -> systemCtx "Opens context per pool"
        depositsJob -> systemCtx "Opens context per pool"
        remindJob -> systemCtx "Opens context per pool"
        snapshotJob -> systemCtx "Opens context per pool"
        systemCtx -> services "Calls with system actor and guards" "in-process"
        pricesJob -> marketData "Requests quotes (capability quote)" "in-process"
        dividendsJob -> marketData "Requests dividends (capability dividends)" "in-process"
        instrumentsJob -> marketData "Searches and maps symbols" "in-process"
        fxJob -> ecb "Fetches daily reference rates" "HTTPS/XML"
        fxJob -> appDb "Writes fx_rates" "SQL"
        cleanupJob -> appDb "Deletes expired data" "SQL"
        pricesJob -> appDb "Writes market_prices" "SQL, market role"
        dividendsJob -> appDb "Writes market_dividends" "SQL, market role"

        marketData -> marketProviders "Fetches quotes, history, dividends, search" "HTTPS/JSON, allow-listed hosts"
        // assumed: optional adapter
        marketData -> fundPages "Reads fund NAV" "HTTPS"
        marketData -> appDb "Persists provider_quotas and symbol mapping" "SQL"
        services -> appDb "Reads and writes pool data under RLS" "SQL, withPool"
    }

    views {
        systemContext nestvault "Context" "NES-8: who feeds data into NestVault" {
            include *
            autolayout lr
        }

        container nestvault "Containers" "NES-8: worker, market data layer and database" {
            include *
            autolayout lr
        }

        component worker "Jobs" "NES-8: jobs inside the worker, by task" {
            include *
            autolayout tb
        }

        styles {
            element "Person" {
                shape person
                background #08427b
                color #ffffff
            }
            element "External" {
                background #999999
                color #ffffff
            }
            element "Database" {
                shape cylinder
            }
            element "Software System" {
                background #1168bd
                color #ffffff
            }
            element "Container" {
                background #438dd5
                color #ffffff
            }
            element "Component" {
                background #85bbf0
                color #000000
            }
        }
    }
}
