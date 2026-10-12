# NestVault — Family finance app ("Cofre Familiar")

Multi-user family finance web app. A pool (household) is shared by several users and all financial
data is isolated per pool. Project rules and architecture: [`CLAUDE.md`](CLAUDE.md). Security
baseline: [`docs/security.md`](docs/security.md). Requirements: Confluence space NestVault and
Jira project NES.

> Status: phase 1 (foundations). The workspace, lint, typecheck and tests work today. Docker,
> database, web app and worker arrive in the next tasks (see the table at the end).

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
```

Check that everything works:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

## Commands

| Command                                 | What it does                                                    |
| --------------------------------------- | --------------------------------------------------------------- |
| `pnpm install`                          | Install dependencies for all workspaces                         |
| `pnpm lint`                             | ESLint (typescript-eslint strict, import order, security rules) |
| `pnpm typecheck`                        | `tsc` in every package and for the root files                   |
| `pnpm test`                             | Vitest, all packages and the lint-rule tests                    |
| `pnpm format` / `pnpm format:check`     | Prettier write / check                                          |
| `pnpm build`                            | Build every package (placeholders for now)                      |
| `pnpm dev` / `pnpm dev:worker`          | Web app / worker. **Placeholders until NES-15 / worker task**   |
| `pnpm env:init`                         | Create `.env.local` with random secrets from `.env.example`     |
| `pnpm db:up` / `db:down`                | Start / stop Postgres and Mailpit in Docker                     |
| `pnpm db:reset`                         | Delete the database volume (asks first) and recreate it         |
| `pnpm db:check`                         | Verify database isolation and network exposure                  |
| `pnpm db:psql:identity` / `db:psql:app` | Open `psql` on that database                                    |
| `pnpm db:migrate` / `db:seed`           | Migrations / seed. **Placeholders until NES-14**                |
| `pnpm test:e2e`                         | Playwright. **Placeholder until the first screens**             |
| `pnpm openapi`                          | Regenerate `docs/api/openapi.json`. **Placeholder**             |

Tests live outside the packages, in `tests/<package>/` (e.g. `tests/domain/`). Run one package's
tests with `pnpm test --project domain`; typecheck all packages with `pnpm -r typecheck`.

## Repository layout

```
apps/web/            Next.js app (not scaffolded yet)
apps/worker/         scheduled jobs (pg-boss)
docker/              Postgres init script (docker-compose.yml and scripts/ are at the root)
packages/domain/     pure calculations, no I/O
packages/services/   use cases + guards
packages/db/         Drizzle schemas, migrations, repositories (identity + app databases)
packages/ui/         tokens and shared components
packages/config/     validated environment variables (the only place that reads process.env)
design/  docs/
tests/<package>/     Vitest tests, one folder per package (+ tests/lint, tests/api)
```

## Accessing the app from a Mac (local development only)

The project runs on an Ubuntu machine and is reached through SSH port forwarding, so the browser
uses `http://localhost:3000` and cookies behave like local dev. Postgres is published on port 5433
(not 5432), so a Postgres already running on the Mac does not clash with the tunnel:

```bash
ssh -L 3000:localhost:3000 -L 8025:localhost:8025 -L 5433:localhost:5433 user@ubuntu-host
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
| Next.js app shell, themes, i18n                | NES-15 |

This README is updated in every task that changes how the project is set up or run.
