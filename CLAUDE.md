# NestVault — Family finance app ("Cofre Familiar")

Multi-user family finance web app. A **pool** (household) is shared by several users; all financial
data is isolated per pool. The v28 HTML prototype is the functional and visual specification:
everything it does must keep working, now server-side and shared.

Reference material (source of truth for behaviour and design):
- `docs/prd.md` — product requirements (server version)
- `docs/handoff.md` — validated business rules and reference values for tests
- `docs/prototype/cofre-familiar-v28.html` — the prototype (behaviour + visuals)
- `docs/tools/` — Python converters (Trade Republic PDF, Banco Invest xlsx → CSV), to be ported
- `design/` — design system (`DESIGN-SYSTEM.md`), tokens (`tokens.css`, `tailwind.preset.js`),
  full prototype CSS, fonts, mockups (`mockups/escuro` = dark, `mockups/claro` = light)

These reference files are the original Portuguese versions; read them as specification.
Everything new is written in English (see below).

## Language

- **Everything is written in English**: code, identifiers, comments, docs, commit messages,
  branch names, PR titles and descriptions, API docs, test names.
- The only exception is user-facing UI text, which goes through i18n (no hard-coded strings in components).

## Current scope (phase 1 — foundations)

- Monorepo, two Postgres databases with migrations, authentication (email + password), pools,
  invites, roles, guards, Row-Level Security, pool-isolation tests.
- **No 2FA in phase 1.** Do not add TOTP or backup codes until a task asks for it; keep the
  design ready for it (no schema or code that blocks it later).
- **Local development only.** No production deploy for now. Target: an Ubuntu machine with Docker,
  accessed from a Mac.

## Stack

TypeScript (strict) monorepo with pnpm workspaces.

| Piece | Choice |
| --- | --- |
| Web | Next.js 15 (App Router, Node runtime), React 19 |
| UI | Tailwind CSS with the prototype tokens (`design/tailwind.preset.js`), shadcn/ui |
| Auth | Better Auth (email + password, DB sessions) |
| ORM / migrations | Drizzle ORM + drizzle-kit, one schema and one migrations folder per database |
| Validation | zod on every input (forms, API, files) |
| Jobs | pg-boss (worker process) |
| API docs | OpenAPI 3.1 generated from zod schemas (`@asteasolutions/zod-to-openapi`), served with Swagger UI |
| Tests | Vitest (unit, integration), Playwright (e2e) |

## Repository layout

```
apps/web/            Next.js: app/(auth), app/(app)/[poolId]/..., app/api/v1/...
apps/worker/         scheduled jobs (pg-boss)
packages/domain/     pure calculations, no I/O (port of the prototype engine)
packages/services/   use cases + guards (requireSession, requirePoolAccess, can)
packages/db/         identity/ and app/: Drizzle schemas, migrations, repositories
packages/importers/  one module per statement format
packages/ui/         tokens and shared components
design/              design system, tokens, fonts, mockups
docs/                PRD, handoff, prototype, API docs (docs/api/), ADRs
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

## Security rules

- **SQL injection:** only use the Drizzle query builder or the `sql` tagged template with bound
  parameters. Never build SQL with string concatenation or template literals, and never pass
  user input to `sql.raw`, `sql.identifier` or dynamic `orderBy`/column names without an
  allow-list. Every new repository function gets a test with an injection payload
  (e.g. `' OR 1=1 --`) proving it is treated as data.
- Validate all input with zod at the boundary (Server Actions, Route Handlers, file imports).
- Passwords: argon2id, min 12 chars. Session cookie: `HttpOnly; SameSite=Lax`
  (`Secure` outside localhost). Only the token hash is stored.
- Write Route Handlers require `Origin` to match the app origin (CSRF).
- Logs never contain amounts, IBANs, tokens or passwords.
- Secrets only via environment variables (`.env.local`, never committed; keep `.env.example` updated).
- Postgres users: `identity_rw` sees only the identity DB; `app_rw` sees only the app DB and
  has no `BYPASSRLS`; a separate migration user.

## Local development

- Postgres runs in Docker (`docker compose up -d`), both databases in one container.
- The Ubuntu machine is accessed from the Mac. Preferred: SSH port forwarding
  (`ssh -L 3000:localhost:3000 -L 5432:localhost:5432 user@ubuntu-host`) so the browser uses
  `http://localhost:3000` and cookies behave like local dev. Alternatively VS Code Remote-SSH.
- Commands (keep this list in sync with `package.json`):
  - `pnpm install`
  - `pnpm db:up` / `pnpm db:migrate` / `pnpm db:seed`
  - `pnpm dev` — web app; `pnpm dev:worker` — worker
  - `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`
  - `pnpm openapi` — regenerate `docs/api/openapi.json`

## Git workflow

- Long-lived branches: **`master`** (stable) and **`dev`** (integration). No other long-lived branches.
- One branch per task, named after the task key: `nstvault-<n>` (e.g. `nstvault-1`),
  created from `dev`, merged back into `dev` by PR. `dev` is merged into `master` by PR.
- Commit messages: `nstvault-<n>: <imperative summary>`.
- Never push directly to `master` or `dev`.

## Definition of done — run at the end of EVERY development task

Before saying a task is finished or opening a PR, do all of the following and report the result
of each step:

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
5. `pnpm lint && pnpm typecheck && pnpm test` all pass.

## Pull requests

- Target branch: `dev` (or `master` for a release from `dev`).
- Title: `nstvault-<n>: <summary>`.
- Body follows `.github/pull_request_template.md`, which must contain:
  - **Task checklist** — a list of checkbox tasks describing what this task is expected to do
    (the acceptance criteria), ticked when done.
  - **What was done** — an explanation of every change (per package/area), design decisions and
    trade-offs.
  - **Definition of done** results (security review, tests, API docs, SQL injection check).
  - **How to test** locally, including Postman requests when relevant.
