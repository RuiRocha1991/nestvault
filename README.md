# NestVault — Family finance app ("Cofre Familiar")

Multi-user family finance web app. A pool (household) is shared by several users and all financial
data is isolated per pool. Project rules and architecture: [`CLAUDE.md`](CLAUDE.md). Security
baseline: [`docs/security.md`](docs/security.md). Requirements: Confluence space NestVault and
Jira project NES.

> Status: phase 1 (foundations). The workspace, the web app shell (layout, themes, pt-PT) and the
> checks work today. Docker, the database and the worker arrive in the next tasks (see the end).

## Prerequisites

| Tool    | Version | Notes                                                                                                             |
| ------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| Node.js | 22.x    | `.nvmrc` pins it. Recommended: [nvm](https://github.com/nvm-sh/nvm)                                               |
| pnpm    | 12.x    | `packageManager` in `package.json`; install with `npm i -g pnpm@12`                                               |
| Git     | any     |                                                                                                                   |
| Docker  | recent  | Compose plugin; Postgres, Mailpit and the parser run in containers                                                |
| uv      | recent  | Only to work on `services/parser` (Python 3.12, installed by uv): [docs.astral.sh/uv](https://docs.astral.sh/uv/) |

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
pnpm parser:up  # statement parser (builds the image); only needed to import statements
pnpm db:check   # verifies database isolation
pnpm db:migrate # applies the migrations to both databases
```

Check that everything works:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

## Commands

| Command                                 | What it does                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm install`                          | Install dependencies for all workspaces                                                                  |
| `pnpm lint`                             | ESLint (typescript-eslint strict, import order, security rules)                                          |
| `pnpm typecheck`                        | `tsc` in every package and for the root files                                                            |
| `pnpm test`                             | Vitest: unit + integration tests. **Needs `pnpm db:up`**                                                 |
| `pnpm test:unit`                        | Unit tests only: nothing needs to be running                                                             |
| `pnpm test:integration`                 | Integration tests only (Postgres, production build for headers)                                          |
| `pnpm test:coverage`                    | `pnpm test` with the coverage report and the thresholds (CI)                                             |
| `pnpm format` / `pnpm format:check`     | Prettier write / check                                                                                   |
| `pnpm build`                            | Build every package (placeholders for now)                                                               |
| `pnpm dev` / `pnpm dev:worker`          | Web app on http://localhost:4000 / the job worker (pg-boss; needs `pnpm db:up` and `pnpm db:migrate`)    |
| `pnpm worker:runs`                      | Last job runs, durations and failures (`--failed`, `--limit N`); read from the `pgboss` schema           |
| `pnpm db:worker-role`                   | Create or refresh the `worker_rw` database role on an existing volume (a fresh volume has it already)    |
| `pnpm env:init`                         | Create `.env.local` with random secrets from `.env.example`                                              |
| `pnpm env:check` / `pnpm env:sync`      | List / add the variables your `.env.local` lacks (names only)                                            |
| `pnpm gen:secret`                       | Print a random 32-byte base64 secret (auth secret, encryption key)                                       |
| `pnpm db:up` / `db:down`                | Start Postgres and Mailpit in Docker / stop every container of the project                               |
| `pnpm parser:up`                        | Build and start the parser container and its local forwarder (`http://127.0.0.1:8100`)                   |
| `pnpm test:parser` / `pnpm lint:parser` | pytest / ruff + mypy for `services/parser` (needs uv; `uv run pytest -m docker` runs the image tests)    |
| `pnpm gen:parser-schema`                | Regenerate the zod schema of the parser output from `services/parser/schemas/`; `--check` fails if stale |
| `pnpm parser:schema`                    | Regenerate `services/parser/schemas/rows.schema.json` from the pydantic models                           |
| `pnpm db:reset`                         | Delete the database volume (asks first) and recreate it                                                  |
| `pnpm db:check`                         | Verify database isolation and network exposure                                                           |
| `pnpm db:psql:identity` / `db:psql:app` | Open `psql` on that database                                                                             |
| `pnpm db:migrate`                       | Apply both migration sets (idempotent), as the migration user                                            |
| `pnpm db:generate:app` / `:identity`    | Generate a migration from the Drizzle schema                                                             |
| `pnpm db:seed`                          | Create the first owner (`SEED_OWNER_EMAIL`/`_PASSWORD`, else prompted); idempotent                       |
| `pnpm test:e2e`                         | Playwright (Chromium): sign-in, smoke + CSP checks on the production build (needs `pnpm db:up`)          |
| `pnpm openapi`                          | Regenerate `docs/api/openapi.json`; `--check` fails if stale (CI)                                        |

Browser checks (`tests/e2e/`) need Chromium once: `pnpm exec playwright install chromium`
(on a fresh Ubuntu add `--with-deps`). `pnpm test:e2e` builds the web app and serves it on port 4010,
so stop anything else using that port; the header integration test in `tests/web` uses it too, so
do not run both at the same time (CI runs them in separate jobs). If browsers are installed
system-wide in `/opt/pw-browsers`, they are used instead of the download. The browser checks also
need Postgres (`pnpm db:up`): before the run, `tests/e2e/global-setup.ts` resets the `_test`
databases, creates a test owner and saves a signed-in session; the server it starts reads the
`_test` databases, never the development ones.

Tests live outside the packages, in `tests/<package>/` (e.g. `tests/domain/`). Run one package's
tests with `pnpm test --project domain`; typecheck all packages with `pnpm -r typecheck`.
A file named `*.integration.test.ts` is an integration test (it runs in the `integration` project,
which prepares the `_test` databases once per run); every other test is a unit test. Details,
factories and coverage thresholds: [`docs/testing.md`](docs/testing.md).

## Running the web app

```bash
pnpm dev        # http://localhost:4000 (redirects to /login until you sign in)
```

Sign in at `/login` with the owner created by `pnpm db:seed`; every other page needs a session
(signed-out visitors go to `/login?next=…`, and the sidebar has "Terminar sessão"). The seeded owner
has no pool yet: `/pools` asks for a name ("Vamos criar o teu agregado") and opens the new pool at
`/<poolId>`. With one pool `/pools` opens it directly; with several it opens the last one used, and
`/pools?escolher=1` (or "Todos os agregados" in the sidebar switcher) shows the chooser. Opening a
pool you do not belong to is a 404. Pages: `/<poolId>` (overview frame) and the other sidebar links
(placeholders). Switch the theme with the toggle in the sidebar footer. On a phone-width window (≤ 860 px) the sidebar becomes a drawer.
The design reference (tokens, components, mockups) lives in Confluence and `design/`, not in a route.

- **Forgotten password and email verification:** `/recuperar` (ask for the link), `/recuperar/<token>`
  (new password) and `/verificar/<token>` (confirm the email). In development every email lands in
  Mailpit (http://localhost:8025); open the link from there. `/verificar` shows "confirm your email"
  to a signed-in user whose address is not verified.
- **Sign-up:** `/registar` (open only with `ALLOW_SIGNUP=true`; closed by default it explains that
  people join by invite). Registering sends a confirmation link (Mailpit in development) and starts
  no session: you can only sign in after opening it. Registering an email that already has an
  account looks the same and warns the owner by email.
- **Invites:** an owner or admin invites somebody by email with a role (the "Convidar utilizador"
  button of Definições → Utilizadores e convites, or `POST /api/v1/pools/<id>/invites`). The email (Mailpit in development) links to
  `/convite/<token>`: single use, valid 7 days, bound to that address. Signed out you can sign in or
  create the account with the invited address (`/convite/<token>/registar`, which works even with
  `ALLOW_SIGNUP=false`; confirm the email, sign in and open the link again); signed in with the invited
  address you accept it; with another address you are asked to switch. Expired, used and unknown links
  show the same generic screen. Pending invites can be listed, resent (new link) and cancelled.
- **Members:** Definições → "Utilizadores e convites" (`/<poolId>/definicoes/membros`). Everybody
  in the pool sees who is in it and can leave it (`POST /api/v1/pools/<id>/leave`; the only owner
  cannot). Owners and admins also see the emails, change roles, remove people (`PATCH`/`DELETE
/api/v1/pools/<id>/members/<userId>`) and manage the pending invites; only the owner hands the pool
  over (`POST /api/v1/pools/<id>/transfer`, confirmed with the password; the owner becomes an admin
  unless they tick "Continuar também como proprietário"). Making somebody an owner by changing their
  role through the API needs the password too.
  A role change or removal ends that person's sessions in the pool, a pool always keeps at least one
  owner, and admins never touch owners. Every action is audited (Definições → Auditoria). See the
  Postman "Members" folder.
- **My account:** `/conta` (link "A minha conta" in the sidebar footer): change the name, change the
  email (the link goes to the new address and the email only changes once it is used), change the
  password (the other sessions end and a notice is emailed) and see or end the active sessions. The
  same data is available as `GET/PATCH /api/v1/me` and `/api/v1/me/sessions` (see Swagger UI and the
  Postman "Account" folder). The location of each session (city) arrives with NES-108.
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
  the pool as a second lock. Services then call `can(ctx, 'accounts.write')`; roles are permission
  sets (`packages/services/src/guards`) and feature code never compares role names.
- `pnpm test` includes the database tests (RLS, pool isolation, injection payloads). They run on the
  `_test` databases, which are dropped and migrated again at the start of each run, so
  **`pnpm db:up` must be running**; if not, the run stops with a message saying so.

## Parser service

Statement parsing (CSV, xlsx, PDF) happens in `services/parser`, a Python 3.12 FastAPI service in its
own container ([`services/parser/README.md`](services/parser/README.md)). `pnpm parser:up` builds and
starts it. The container has no route to the internet and no volumes, runs as a non-root user with a
read-only filesystem and CPU/memory limits; only a forwarder published on `127.0.0.1:8100` reaches it.
Every call needs the `X-Parser-Secret` header (`PARSER_SECRET`, created by `pnpm env:init`; after
pulling run `pnpm env:sync`). Work on it with uv: `cd services/parser && uv sync && uv run pytest`.

### Importing statements

`POST /api/v1/pools/:poolId/imports` takes a statement (`.xlsx`, `.pdf` or `.csv`, 10 MB at most),
shows what would be added, and `POST …/imports/:batchId/commit` writes it; see the "Statement
imports" folder of the Postman collection (`tests/api/`). The upload is kept **encrypted** (AES-256-GCM
with `APP_ENCRYPTION_KEY`) under `IMPORT_STORAGE_DIR` (default `.data/imports`, git-ignored): back the
folder up together with the key, and to rotate the key put the new one first as
`APP_ENCRYPTION_KEY=new:<key>,old:<key>`. The parser container must be running (`pnpm parser:up`)
for an import; the rest of the app does not need it.

In the app, **Contas e poupanças → Importar extrato** (`/<poolId>/importar`) is the screen for it: drop a
file, the format is detected, choose the account, check the preview and confirm. Importing needs the
`imports.run` permission (owner, admin and member; not viewer). The Playwright import specs
(`tests/e2e/import.spec.ts`) also need the parser container; their generated statements are in
`tests/e2e/fixtures/imports` (regenerate with `cd services/parser && uv run python scripts/export_e2e_fixtures.py`).

## Repository layout

```
apps/web/            Next.js 15 app (App Router, next-intl, Tailwind with the design tokens)
apps/worker/         scheduled and on-demand jobs (pg-boss): runtime, job registry, runs CLI
docker/              Postgres init script (docker-compose.yml and scripts/ are at the root)
packages/domain/     pure calculations, no I/O
packages/services/   use cases + guards
packages/db/         Drizzle schemas, migrations, repositories (identity + app databases)
packages/ui/         base components (shadcn-style, token based) and pt-PT formatters
packages/config/     validated environment variables (the only place that reads process.env):
                     `@nestvault/config` is server-only, `@nestvault/config/public` is browser-safe
packages/crypto/     AES-256-GCM with key ids and rotation (encrypts uploaded statements at rest)
services/parser/     Python parser service (FastAPI): isolated container, parsers, shared schemas
design/  docs/
tests/<package>/     Vitest tests, one folder per package (+ tests/lint, tests/api)
```

## Before putting it online (reverse proxy)

Not needed for local development. Do this before the app is reachable from the internet:

- Run the app **behind a reverse proxy or CDN** (Caddy, nginx, Cloudflare) that terminates HTTPS
  and appends the client address to `x-forwarded-for`, and set `APP_URL` to the public `https://`
  origin.
- Set `TRUSTED_PROXY_HOPS` to the number of proxies you run in front of the app (`1` for one). The
  rate limiter then limits each machine separately (5 failed sign-ins / 15 min per IP and per
  email), so one attacker never blocks other users. With `0` the header is ignored and all clients
  share one loose limit (50 / 15 min), and the web process logs a warning in production.
- The app's port must not be reachable except through the proxy (bind it to localhost or a private
  network, firewall the rest). Otherwise a client can talk to the app directly and send its own
  `x-forwarded-for`.
- Replace Mailpit with a real SMTP server: set `SMTP_HOST`, `SMTP_PORT` (587 STARTTLS or 465),
  `SMTP_USER`, `SMTP_PASSWORD` and `SMTP_FROM` (an address on a domain with SPF and DKIM). With a
  login, the connection must use TLS or nothing is sent. Reset and verification emails use `APP_URL`
  for their links, so it must be the public `https://` origin.
- Count every proxy that appends to the header: CDN + Caddy is `2`.

See `docs/security.md` control 11.

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
