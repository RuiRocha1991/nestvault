# NestVault — Family finance app ("Cofre Familiar")

Multi-user family finance web app. A pool (household) is shared by several users and all financial
data is isolated per pool. Project rules and architecture: [`CLAUDE.md`](CLAUDE.md). Security
baseline: [`docs/security.md`](docs/security.md). Requirements: Confluence space NestVault and
Jira project NES.

> Status: phase 1 (foundations). The workspace, the web app shell (layout, themes, pt-PT) and the
> checks work today. Docker, the database and the worker arrive in the next tasks (see the end).

## Prerequisites

| Tool    | Version | Notes                                                               |
| ------- | ------- | ------------------------------------------------------------------- |
| Node.js | 22.x    | `.nvmrc` pins it. Recommended: [nvm](https://github.com/nvm-sh/nvm) |
| pnpm    | 12.x    | `packageManager` in `package.json`; install with `npm i -g pnpm@12` |
| Git     | any     |                                                                     |
| Docker  | recent  | Compose plugin; Postgres and Mailpit run in containers              |

## Setup (from a fresh clone)

```bash
git clone git@github.com:RuiRocha1991/nestvault.git
cd nestvault
nvm install && nvm use          # reads .nvmrc (Node 22)
npm i -g pnpm@12                # once per Node version
pnpm install --frozen-lockfile
```

Dependency install scripts are blocked by default (`allowBuilds` in `pnpm-workspace.yaml`,
security control 20). If pnpm reports a new package with a build script, review it before
allowing it with `pnpm approve-builds`.

Create the local environment and start the services (details: [`docs/dev-setup.md`](docs/dev-setup.md)):

```bash
pnpm env:init   # creates .env.local with random passwords (never committed)
pnpm db:up      # Postgres 16 (two databases) + Mailpit, bound to 127.0.0.1
pnpm db:check   # verifies database isolation
pnpm db:migrate # applies the migrations to both databases
```

Check that everything works:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

## Commands

| Command                                 | What it does                                                       |
| --------------------------------------- | ------------------------------------------------------------------ |
| `pnpm install`                          | Install dependencies for all workspaces                            |
| `pnpm lint`                             | ESLint (typescript-eslint strict, import order, security rules)    |
| `pnpm typecheck`                        | `tsc` in every package and for the root files                      |
| `pnpm test`                             | Vitest: unit + integration tests. **Needs `pnpm db:up`**           |
| `pnpm test:unit`                        | Unit tests only: nothing needs to be running                       |
| `pnpm test:integration`                 | Integration tests only (Postgres, production build for headers)    |
| `pnpm test:coverage`                    | `pnpm test` with the coverage report and the thresholds (CI)       |
| `pnpm format` / `pnpm format:check`     | Prettier write / check                                             |
| `pnpm build`                            | Build every package (placeholders for now)                         |
| `pnpm dev` / `pnpm dev:worker`          | Web app on http://localhost:4000 / worker (**placeholder**)        |
| `pnpm env:init`                         | Create `.env.local` with random secrets from `.env.example`        |
| `pnpm env:check` / `pnpm env:sync`      | List / add the variables your `.env.local` lacks (names only)      |
| `pnpm gen:secret`                       | Print a random 32-byte base64 secret (auth secret, encryption key) |
| `pnpm db:up` / `db:down`                | Start / stop Postgres and Mailpit in Docker                        |
| `pnpm db:reset`                         | Delete the database volume (asks first) and recreate it            |
| `pnpm db:check`                         | Verify database isolation and network exposure                     |
| `pnpm db:psql:identity` / `db:psql:app` | Open `psql` on that database                                       |
| `pnpm db:migrate`                       | Apply both migration sets (idempotent), as the migration user      |
| `pnpm db:generate:app` / `:identity`    | Generate a migration from the Drizzle schema                       |
| `pnpm db:seed`                          | Seed data. **Placeholder until the first tables**                  |
| `pnpm test:e2e`                         | Playwright (Chromium): smoke + CSP checks on the production build  |
| `pnpm openapi`                          | Regenerate `docs/api/openapi.json`; `--check` fails if stale (CI)  |

Browser checks (`tests/e2e/`) need Chromium once: `pnpm exec playwright install chromium`
(on a fresh Ubuntu add `--with-deps`). `pnpm test:e2e` builds the web app and serves it on port 4010,
so stop anything else using that port; the header integration test in `tests/web` uses it too, so
do not run both at the same time (CI runs them in separate jobs). If browsers are installed
system-wide in `/opt/pw-browsers`, they are used instead of the download.

Tests live outside the packages, in `tests/<package>/` (e.g. `tests/domain/`). Run one package's
tests with `pnpm test --project domain`; typecheck all packages with `pnpm -r typecheck`.
A file named `*.integration.test.ts` is an integration test (it runs in the `integration` project,
which prepares the `_test` databases once per run); every other test is a unit test. Details,
factories and coverage thresholds: [`docs/testing.md`](docs/testing.md).

## Running the web app

```bash
pnpm dev        # http://localhost:4000 (redirects to /demo)
```

There is no sign-in or pool yet (NES-19, NES-26), so `/demo` stands in for `/[poolId]`. Pages:
`/demo` (overview frame) and the other sidebar links (placeholders). Switch the theme with the
toggle in the sidebar footer. On a phone-width window (≤ 860 px) the sidebar becomes a drawer.
The design reference (tokens, components, mockups) lives in Confluence and `design/`, not in a route.

- **Theme:** dark by default; the choice is stored in the `nv-theme` cookie and rendered on the
  server, so a refresh does not flash.
- **Texts:** every visible string lives in `apps/web/messages/pt-PT.json` (English keys). ESLint
  fails on text typed directly in JSX.
- **Formats:** `formatMoney`, `formatDate` and `formatPct` in `@nestvault/ui` (`1 234,56 €`,
  `11/10/2026`).
- **Fonts:** self-hosted from `design/fonts`; no request to Google Fonts.

## REST API

Every endpoint under `/api/v1` is a Route Handler wrapped in `route()` (`apps/web/src/server/api`):
request id (`x-request-id`), same-`Origin` check on writes, typed errors mapped to
`{ error: { code, message }, requestId }`, JSON logs without secrets.

- `GET http://localhost:4000/api/v1/health` answers `{"status":"ok"}` (no sign-in).
- **Swagger UI:** http://localhost:4000/api/docs. Served only when `ENABLE_API_DOCS=true` (set in
  `.env.local` by `pnpm env:init`) **and** the app is not in production mode; otherwise a 404.
- **OpenAPI document:** `docs/api/openapi.json`, generated from the zod schemas. Run `pnpm openapi`
  after adding or changing an endpoint; `pnpm openapi --check` (CI) fails when it is stale.
- **Postman / Insomnia:** `tests/api/` (collection, environment and how to sign in with the cookie jar).

## Environment variables

All configuration comes from environment variables, validated once at boot by `@nestvault/config`
(zod). If one is missing or invalid, the process exits and prints the **names** and a reason, never
the values. `.env.example` lists every variable; `pnpm env:init` copies it to `.env.local` with
random secrets.

- Server code: `import { env } from '@nestvault/config'` (server-only: importing it from a client
  component fails the build). `process.env` is read nowhere else (ESLint enforces it).
- Browser code: `import { publicEnv } from '@nestvault/config/public'`, an explicit allow-list
  (`NEXT_PUBLIC_APP_NAME`). Never put a secret behind `NEXT_PUBLIC_`.
- The web and worker processes do not get the migration user; migrations and tests load their own
  connections with `loadMigratorEnv()` and `loadTestEnv()`.
- Adding a variable: add it to the schema in `packages/config/src/schema.ts` and to
  `.env.example`, bump `# env-version` there and add a line to "Environment versions" in
  `docs/dev-setup.md` (tests fail if they drift apart). After pulling, `pnpm env:check` tells you
  whether your `.env.local` lacks anything and `pnpm env:sync` adds it.

## Database

Two databases that are never joined: `nestvault_identity` and `nestvault_app` (Drizzle, one schema
folder and one migrations folder each, in `packages/db`).

- `pnpm db:migrate` applies pending migrations to both as `nestvault_migrator`; run it as often as
  you like. To change the schema use the `db-migration` skill (`pnpm db:generate:app`).
- Application code reaches `nestvault_app` only through `withPool(ctx, tx => …)`, where `ctx` is a
  `PoolContext` that only `requirePoolAccess` can create; Postgres Row-Level Security then enforces
  the pool as a second lock.
- `pnpm test` includes the database tests (RLS, pool isolation, injection payloads). They run on the
  `_test` databases, which are dropped and migrated again at the start of each run, so
  **`pnpm db:up` must be running**; if not, the run stops with a message saying so.

## Repository layout

```
apps/web/            Next.js 15 app (App Router, next-intl, Tailwind with the design tokens)
apps/worker/         scheduled jobs (pg-boss)
docker/              Postgres init script (docker-compose.yml and scripts/ are at the root)
packages/domain/     pure calculations, no I/O
packages/services/   use cases + guards
packages/db/         Drizzle schemas, migrations, repositories (identity + app databases)
packages/ui/         base components (shadcn-style, token based) and pt-PT formatters
packages/config/     validated environment variables (the only place that reads process.env):
                     `@nestvault/config` is server-only, `@nestvault/config/public` is browser-safe
design/  docs/
tests/<package>/     Vitest tests, one folder per package (+ tests/lint, tests/api)
```

## Accessing the app from a Mac (local development only)

The project runs on an Ubuntu machine and is reached through SSH port forwarding, so the browser
uses `http://localhost:4000` and cookies behave like local dev. Postgres is published on port 5433
(not 5432), so a Postgres already running on the Mac does not clash with the tunnel:

```bash
ssh -L 4000:localhost:4000 -L 8025:localhost:8025 -L 5433:localhost:5433 user@ubuntu-host
```

## Git workflow

- `master` (stable) and `dev` (integration). Branch per task, named after the Jira key, created
  from `dev`: `git fetch origin dev && git checkout -b NES-12 origin/dev`.
- Commit messages start with the key: `NES-12: add accounts repository`.
- Open a PR to `dev`; do not push to `dev` or `master` directly.

## What is not set up yet

| Item                                           | Task   |
| ---------------------------------------------- | ------ |
| Validated config package (`@nestvault/config`) | NES-13 |
| Drizzle, `PoolContext`, RLS harness            | NES-14 |

This README is updated in every task that changes how the project is set up or run.
