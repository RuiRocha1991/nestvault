# NestVault — Family finance app ("Cofre Familiar")

Multi-user family finance web app. A **pool** (household) is shared by several users; all financial
data is isolated per pool. The v28 HTML prototype is the functional and visual specification:
everything it does must keep working, now server-side and shared.

Reference material (source of truth for behaviour and design):
- **Confluence space NestVault** — the English PRD (source of truth for requirements):
  https://ruirrocha.atlassian.net/wiki/spaces/NestVault/pages/11665409 (PRD 01–08 and one
  "FR — …" page per module), Design — Mockups, Design — Design system, Backlog — Jira NES.
- **Jira project NES** — epics NES-1…NES-10 (one per phase area), tasks with acceptance criteria and
  links to their Confluence page; app-level acceptance checklist in NES-85.
- `docs/prd.md` — original product requirements (Portuguese)
- `docs/handoff.md` — validated business rules and reference values for tests
- `docs/prototype/cofre-familiar-v28.html` — the prototype (behaviour + visuals)
- `docs/tools/` — Python converters (Trade Republic PDF, Banco Invest xlsx → CSV), to be ported
- `design/` — design system (`DESIGN-SYSTEM.md`), tokens (`tokens.css`, `tailwind.preset.js`),
  full prototype CSS, fonts, mockups (`mockups/escuro` = dark, `mockups/claro` = light)

- `docs/adr/` — architecture decisions; they override the PRD where they differ
  (0001 statement parsing and AI-assisted import specs, 0002 market data providers,
  0003 plans and entitlements, 0004 global categories)

These reference files are the original Portuguese versions; read them as specification.
Everything new is written in English (see below).

## Language

- **Everything is written in English**: code, identifiers, comments, docs, commit messages,
  branch names, PR titles and descriptions, API docs, test names.
- The only exception is user-facing UI text: the UI is in **Portuguese (pt-PT)**, always through
  i18n (`next-intl`, messages in `apps/web/messages/pt-PT.json`, keys in English). No hard-coded
  strings in components. Formats: dates `dd/mm/aaaa`, numbers `1 234,56 €`.

## Current scope (phase 1 — foundations)

- Monorepo, two Postgres databases with migrations, authentication (email + password), pools,
  invites, roles, guards, Row-Level Security, pool-isolation tests.
- **No 2FA in phase 1.** Do not add TOTP or backup codes until a task asks for it; keep the
  design ready for it (no schema or code that blocks it later).
- **Local development only.** No production deploy for now. Target: an Ubuntu machine with Docker,
  accessed from a Mac.

## Product decisions added after the original PRD

- **Sessions persist**: refresh, new tab, browser restart and server restart never log the user out
  while the session is valid (DB sessions, persistent cookie, server-side session read). See NES-21.
- **Notes**: every transaction and investment operation can have a note; every month has a month
  note; a monthly review screen `/[poolId]/mes/[yyyy-mm]` combines the numbers and the notes
  (NES-45, NES-53, NES-54, NES-36). Notes are user content: escaped on render, never logged,
  never overwritten by imports.
- **Statement import** through the Python parser service with automatic detection; AI-assisted
  specs in phase 5 (ADR 0001).
- **Market data** behind swappable providers, free sources first, one env var to switch to a paid
  provider; prices hourly, dividends daily, estimated dividends when nothing is announced (ADR 0002).
- **Plans**: Free (3 accounts, 2 portfolios, owner only, no real estate) and Pro (no limits). Free pools can open Pro
  pages with read-only demo data; every action opens the Pro dialog (ADR 0003 addendum). Enforce
  through `assertWithinLimit` / `assertFeature` in services, never in feature code; billing off by
  default (`BILLING_ENABLED=false` = everything Pro) (ADR 0003).
- **Categories**: global catalogue (`pool_id IS NULL`, names via i18n) + pool-only custom
  categories; budgets per pool (ADR 0004).
- **Real estate and loans** (Pro, phase 6): properties, mortgages with installment breakdown,
  prepayments, rate changes, works projects with payment phases; net worth gains liabilities.

## Stack

TypeScript (strict) monorepo with pnpm workspaces.

| Piece | Choice |
| --- | --- |
| Web | Next.js 15 (App Router, Node runtime), React 19 |
| UI | Tailwind CSS with the prototype tokens (`design/tailwind.preset.js`), shadcn/ui |
| i18n | next-intl, default locale `pt-PT` |
| Auth | Better Auth (email + password, DB sessions) |
| ORM / migrations | Drizzle ORM + drizzle-kit, one schema and one migrations folder per database |
| Validation | zod on every input (forms, API, files) |
| Jobs | pg-boss (worker process) |
| Statement parsing | Python parser service (FastAPI, pdfplumber, openpyxl), isolated container — see ADR 0001 |
| API docs | OpenAPI 3.1 generated from zod schemas (`@asteasolutions/zod-to-openapi`), served with Swagger UI |
| Tests | Vitest (unit, integration), Playwright (e2e) |

## Repository layout

```
apps/web/            Next.js: app/(auth), app/(app)/[poolId]/..., app/api/v1/...
apps/worker/         scheduled jobs (pg-boss)
packages/domain/     pure calculations, no I/O (port of the prototype engine)
packages/services/   use cases + guards (requireSession, requirePoolAccess, can)
packages/db/         identity/ and app/: Drizzle schemas, migrations, repositories
services/parser/     Python parser service: code parsers, spec engine, specs, fixtures (ADR 0001)
packages/ui/         tokens and shared components
design/              design system, tokens, fonts, mockups
docs/                PRD, handoff, prototype, security baseline, API docs (docs/api/), ADRs (docs/adr/)
tests/<package>/     all Vitest tests, one folder per package (tests/domain, tests/services, …);
                     `*.integration.test.ts` needs Postgres; shared factories in tests/support/;
                     Playwright specs in tests/e2e/ (see docs/testing.md)
tests/lint/          tests for the custom ESLint rules
tests/api/           Postman/Insomnia collections and environments (JSON)
```

## Architecture rules (never break)

1. Dependencies only go down: presentation → services → domain + repositories → Postgres.
   Only repositories talk to the database.
2. Two databases, never joined: `nestvault_identity` (users, sessions, pools, members, invites,
   audit) and `nestvault_app` (all financial data, every table has `pool_id uuid not null` + RLS).
   They only exchange IDs (UUID v7).
3. **No query without a `PoolContext`.** Every `app` repository function takes a `PoolContext`,
   which only `requirePoolAccess` can create (opaque type). Every query filters by
   `pool_id = ctx.poolId` and runs inside `withPool(ctx, tx => …)`, which does
   `SET LOCAL app.pool_id` so RLS policies apply.
4. Guards run in the service layer, in this order: session → input validation (zod) →
   pool membership (`requirePoolAccess`, returns **404**, not 403, to non-members) →
   permission (`can(ctx, 'resource.action')`, returns 403) → `withPool` (RLS) + audit log.
5. Permissions are strings (`accounts.write`, `imports.run`, …); roles are sets of permissions.
   Never check a role name directly in feature code.
6. Money is `numeric(18,4)`, quantities `numeric(20,8)`, dates `date`. Never use JS `number`
   floats for money arithmetic in the domain; use a decimal library.
7. Derived values (balances, positions, deposit interest) are computed in `packages/domain`.

## UI conventions

- Inside `apps/web/src`, import with the `@webapp/…` alias (`@webapp/server/api/route`), not long
  `../../..` paths; each future app gets its own alias (`@worker/…`). Same-folder `./x` stays relative.

- All visible text comes from `apps/web/messages/pt-PT.json` (`useTranslations` /
  `getTranslations`); ESLint rejects text and `title`/`alt`/`placeholder`/`aria-label` literals in
  JSX under `apps/web` and `packages/ui`. Shared components take their labels as props.
- Conditional JSX is `cond && <X />`, never `cond ? <X /> : null` (ESLint enforces it); write
  `!!value && …` when the value is a ReactNode that can be `0`.
- Colours, spacing, radii and fonts come from `design/tokens.css` through the Tailwind preset
  (`bg-panel`, `text-fg-2`, …); no hard-coded hex values in components except data colours.
- Money, dates and percentages are formatted only with `formatMoney`, `formatDate` and
  `formatPct` from `@nestvault/ui`.
- The theme is the `nv-theme` cookie (`dark` | `light`), rendered into `<html data-theme>` on the
  server. Cookie values are validated with `parseTheme` before use.

## Security rules

`docs/security.md` is the security baseline: 21 controls, each with where it lives and how it is
verified. Read it before touching auth, routes, tables, uploads, logging, env vars or
dependencies. The essentials:

- **SQL injection:** only use the Drizzle query builder or the `sql` tagged template with bound
  parameters. Never build SQL with string concatenation or template literals, and never pass
  user input to `sql.raw`, `sql.identifier` or dynamic `orderBy`/column names without an
  allow-list. Every new repository function gets a test with an injection payload
  (e.g. `' OR 1=1 --`) proving it is treated as data.
- Validate all input with zod at the boundary; input schemas are `.strict()` (no mass assignment);
  `pool_id`, ids, roles and authors never come from the request body.
- Responses are built from output schemas (DTOs), never raw DB rows.
- Authentication is checked in services (`requireSession`), never only in `middleware.ts`.
- Passwords: argon2id, min 12 chars. Session cookie: `HttpOnly; SameSite=Lax`
  (`Secure` outside localhost). Only the token hash is stored.
- Write Route Handlers require `Origin` to match the app origin (CSRF).
- Errors to clients are generic; logs never contain amounts, IBANs, emails, tokens or passwords.
- Secrets only via environment variables (`.env.local`, never committed; keep `.env.example`
  updated). Never `NEXT_PUBLIC_` for a secret. Claude must not read `.env` files.
- Postgres users: `identity_rw` sees only the identity DB; `app_rw` sees only the app DB and
  has no `BYPASSRLS`; `worker_rw` (worker process only) sees only the app DB, has no `BYPASSRLS` and
  uses the job queues in schema `pgboss`; a separate migration user. Postgres port bound to `127.0.0.1`.
- Sign-up closed by default (`ALLOW_SIGNUP=false`); people join by invite.

## Local development

- Postgres runs in Docker (`docker compose up -d`), both databases in one container.
- The Ubuntu machine is accessed from the Mac. Preferred: SSH port forwarding
  (`ssh -L 4000:localhost:4000 -L 8025:localhost:8025 -L 5433:localhost:5433 user@ubuntu-host`) so the browser uses
  `http://localhost:4000` and cookies behave like local dev. Alternatively VS Code Remote-SSH.
- Commands (keep this list in sync with `package.json`):
  - `pnpm install`
  - `pnpm env:init` — create `.env.local` (random secrets; Claude must not read it)
  - `pnpm env:check` / `pnpm env:sync` — list / add the variables `.env.local` lacks (names only);
    changing `.env.example` means bumping its `# env-version` and the table in `docs/dev-setup.md`
  - `pnpm gen:secret` — print a random 32-byte base64 secret
  - `pnpm db:up` / `pnpm db:down` / `pnpm db:reset` / `pnpm db:check` / `pnpm db:psql:identity` /
    `pnpm db:psql:app` / `pnpm db:migrate` / `pnpm db:seed`
  - `pnpm dev` — web app; `pnpm dev:worker` — worker; `pnpm worker:runs` — last job runs and failures;
    `pnpm db:worker-role` — create `worker_rw` on an existing volume; `pnpm build`
  - `pnpm db:generate:app` / `pnpm db:generate:identity` — generate a migration from the schema
  - `pnpm lint`, `pnpm typecheck`, `pnpm test` (needs `pnpm db:up`: it includes the integration
    tests), `pnpm test:unit` (nothing running), `pnpm test:integration`, `pnpm test:coverage`
    (thresholds: domain 90%, services 80% lines), `pnpm test:e2e`
  - `pnpm format` / `pnpm format:check` — Prettier
  - `pnpm openapi` — regenerate `docs/api/openapi.json`

## Git workflow

- Tasks are Jira issues in project **NES**. The branch name **is the Jira key** (e.g. `NES-12`)
  and every commit message starts with it: `NES-12: <imperative summary>`.
- **Current mode: work from `dev`.** `master` (stable) and `dev` (integration) are long-lived.
  Every task gets a branch named after the Jira key, created **from `dev`**
  (`git fetch origin dev && git checkout -b NES-12 origin/dev`), and is merged back into `dev`
  by PR (the user validates and merges). Never commit or push directly to `dev` or `master`;
  `dev` → `master` by PR only when the user asks for a release.
- **Separate commits while the PR is open, one commit when it merges.**
  - From the first push until the user says the PR is OK to merge, every change (review fixes,
    simplifications, follow-ups) goes in a **new commit** on the task branch, named
    `NES-12: <imperative summary of that change>`. **Never amend, squash or force-push** during this
    phase, so the user can compare commits and see what changed after each round.
  - Only when the user explicitly says everything is OK and the PR can be merged: squash the task
    branch into a single commit (`git reset --soft origin/dev && git commit`, message
    `NES-12: <summary of the whole task>`, then `git push --force-with-lease`; only ever on the task
    branch), wait for the checks, merge with `gh pr merge --squash`, delete the task branch and set
    the Jira task to `Concluído`. `dev` therefore keeps exactly one commit per task.
- **Save CI minutes** (GitHub Actions has a monthly quota; a full run takes ~15 min): run
  `pnpm lint && pnpm typecheck && pnpm test` locally and fix failures **before every push**; batch
  related changes into one push instead of pushing each commit; do not push only to "see if CI
  passes". A new push cancels the previous run of the same PR, docs-only PRs skip the heavy jobs,
  and Playwright only runs for PRs to `master` or PRs that touch the web app (`docs/testing.md` → CI).
- **Keep the Jira status in sync, always** (statuses: `A fazer`, `Em Progresso`, `Concluído`):
  - starting a task → `Em Progresso`;
  - PR open and waiting for the user → stays `Em Progresso`;
  - PR merged / the user confirms it is finished → `Concluído`;
  - work paused or dropped → back to `A fazer`.
  Do the transition in the same turn the state changes, and say which one was done.

## README

`README.md` is the step-by-step guide to set the project up and run it. Keep it exactly as true as
the repository: whenever a task changes how to set up, configure, run, test or build the project
(prerequisites, env vars, Docker services, ports, scripts, migrations, seeds, new apps), update
`README.md` in the same PR and tick it in the definition of done.

## Project skills (`.claude/skills/`)

| Skill | Use it when |
| --- | --- |
| `start-task` | Starting any Jira task: reads the issue, creates the branch, writes the plan and acceptance criteria |
| `protected-route` | Adding/changing any route, Server Action, API endpoint or CRUD |
| `db-migration` | Any table, column, index or repository change (RLS + isolation tests) |
| `new-importer` | Any statement importer (bank/broker file), parser service, detection, import specs |
| `nestvault-domain` | Any calculation in `packages/domain` and its reference values |
| `finish-task` | **At the end of every task** — runs the definition of done and writes the PR |

Built-in skills used by them: `/security-review`, `/code-review`, `xlsx`, `pdf` (fixtures),
`dataviz` (charts), `run` (see the app working).

## Definition of done — run at the end of EVERY development task

Use the `finish-task` skill. Before saying a task is finished, pushing, or opening a PR, do all
of the following and report the result of each step:

1. **Security review for new routes.** If the change adds or modifies any route (page, Server
   Action, Route Handler under `/api`, worker job entry point), run the `/security-review` skill
   and fix every finding (or explain in the PR why it does not apply). Check explicitly: session
   guard, zod validation, `requirePoolAccess` (404 for non-members), `can()` permission (403),
   `withPool`/RLS, audit log, CSRF/Origin, rate limits.
2. **Unit tests for every service.** Every function in `packages/services` and
   `packages/domain` that can be unit tested has Vitest tests (happy path, validation failure,
   permission denied, other-pool access denied). Importers get a fixture-based test.
   `pnpm test` must be green.
3. **REST API documentation.** Every Route Handler under `/api/v1` is registered in the OpenAPI
   registry (request/response zod schemas, auth, error codes) and `pnpm openapi` is run so
   `docs/api/openapi.json` is up to date (Swagger UI at `/api/docs` in dev). When it makes sense,
   add or update the Postman collection in `tests/api/` (`nestvault.postman_collection.json`
   plus `local.postman_environment.json`) with example requests for the new endpoints.
4. **SQL injection check.** Re-read every new or changed query against the SQL injection rules
   above; add injection-payload tests for new repository functions.
5. **Security baseline.** Walk `docs/security.md`; every control the change touches has its
   "Verified by" check in place.
6. `pnpm lint && pnpm typecheck && pnpm test` all pass.
7. **README and Jira.** `README.md` still matches the real setup steps; the Jira status is
   correct for the current state (see Git workflow).

## Pull requests

- Target branch: `dev` (or `master` for a release from `dev`).
- Title: `<KEY>: <summary>`.
- Body follows `.github/pull_request_template.md`, which must contain:
  - **Task checklist** — a list of checkbox tasks describing what this task is expected to do
    (the acceptance criteria), ticked when done.
  - **What was done** — an explanation of every change (per package/area), design decisions and
    trade-offs.
  - **Definition of done** results (security review, tests, API docs, SQL injection, security baseline).
  - **How to test** locally, including Postman requests when relevant.
