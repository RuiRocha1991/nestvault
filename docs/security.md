# Security baseline

Twenty-one controls every change must respect. Each control says **what** we do, **where** it lives and
**how it is verified**. "Verified by" is what makes a control real: a test, a CI job or a review
step. A control with no automated check is reviewed by the `finish-task` skill and `/security-review`.

Status legend: **Now** = required from phase 1 · **Ready** = design must allow it, enforced when we
leave local-only development · **N/A** = does not apply to this stack (with the reason).

| # | Control | Status |
| --- | --- | --- |
| 1 | Keep API keys server-side | Now |
| 2 | No secrets in git | Now |
| 3 | No database credentials reachable by clients | Now (adapted) |
| 4 | Row-Level Security | Now |
| 5 | Encryption of sensitive data | Now (partial) |
| 6 | Server-side authentication | Now |
| 7 | Access control (pool + permission) | Now |
| 8 | Block mass assignment | Now |
| 9 | Secure cookies | Now |
| 10 | Password hashing | Now |
| 11 | Rate limiting | Now |
| 12 | Bot protection | Now (invite-only) / Ready (captcha) |
| 13 | Parameterized queries | Now |
| 14 | Input validation | Now |
| 15 | No data leaks in errors, logs and bundles | Now |
| 16 | Restricted uploads | Now (from the importers phase) |
| 17 | Minimal API responses | Now |
| 18 | Security headers | Now |
| 19 | HTTPS only | Ready |
| 20 | Dependency scanning | Now |
| 21 | Parser isolation and AI safety | Now (parser service) / phase 5 (AI) |

---

## 1. Keep API keys server-side
- **What:** third-party keys (`PRICES_API_KEY`, email) are read only on the server (worker, services).
  Never use the `NEXT_PUBLIC_` prefix for a secret; never import `env` server modules into client components.
- **Where:** `packages/config` (zod-validated env). `@nestvault/config` has `import 'server-only'`;
  the only browser-safe entry is `@nestvault/config/public` (explicit allow-list, no secrets). The
  web/worker runtime never receives the migration user: it is read by `loadMigratorEnv()` only.
- **Verified by:** CI step that fails if any `NEXT_PUBLIC_*` variable name matches
  `KEY|SECRET|TOKEN|PASSWORD`; `server-only` makes a client import a build error (checked in
  NES-13 with a temporary client component); `tests/config/boundaries.test.ts` checks the
  server/public split; ESLint forbids `process.env` outside `packages/config`.

## 2. No secrets in git
- **What:** `.env*` files are ignored (only `.env.example` is committed, with placeholders).
  If a secret is ever committed, **rotate it** — rewriting history is not enough.
- **Where:** `.gitignore`, `.github/workflows/security.yml`.
- **Verified by:** gitleaks on every push and PR; Claude is denied reading `.env*` files
  (`.claude/settings.json`); `tests/config/env-example.test.ts` checks that `.env.example` holds
  only placeholders for secrets and passwords.

## 3. No database credentials reachable by clients
- **Why adapted:** the original advice is about Supabase/Firebase "public" keys used from the
  browser. We have no such key: the browser never talks to Postgres.
- **What:** Postgres is only reachable by the server. In `docker-compose.yml` the port is bound to
  `127.0.0.1` (access from the Mac through the SSH tunnel). DB URLs only in server env.
- **Verified by:** review of `docker-compose.yml` in `finish-task`; control 1 checks.

## 4. Row-Level Security
- **What:** every table in `nestvault_app` has `pool_id uuid not null`, `ENABLE` **and** `FORCE ROW
  LEVEL SECURITY`, and a policy `pool_id = app_current_pool_id()` (a function that reads
  `app.pool_id` and treats unset or empty as "no pool"). The app connects as `app_rw` (not table
  owner, no `BYPASSRLS`). Queries run in `withPool(ctx, …)`, which opens a transaction and runs
  `set_config('app.pool_id', $1, true)` with a bound parameter, so the setting is local to the
  transaction and cannot leak to the next user of a pooled connection.
- **Where:** `packages/db/migrations/app` (policy function and per-table RLS blocks),
  `packages/db/src/app/with-pool.ts`, `packages/db/src/app/rls-audit.ts`.
- **Verified by:** `tests/db/rls-audit.test.ts` queries `pg_class` and fails if any app table
  (except the global `fx_rates` and `import_specs`) lacks `relrowsecurity` **and**
  `relforcerowsecurity` (demonstrated with tables that have none or only ENABLE);
  `tests/db/with-pool.test.ts` shows that outside `withPool` no row is visible, that a select with
  no `where` returns only the pool's rows, that inserting another pool's row fails the `WITH CHECK`,
  and that the setting does not leak across a reused connection; pool-isolation tests for every
  repository (read and write of another pool's row must fail, with RLS and, on an RLS-less twin
  table, with the repository's own `where` alone). The same tests were mutation-checked: breaking
  the policy function, the predicate or the repository filter makes them fail.

## 5. Encryption of sensitive data
- **What:** in transit — HTTPS when not local (see 19). At rest — AES-256-GCM with
  `APP_ENCRYPTION_KEY` (key id stored with the ciphertext so the key can rotate) for: original
  imported statement files and, later, TOTP secrets. Amounts and dates stay in clear (they are
  queried and aggregated); IBANs are stored in clear but never logged (decision to revisit).
  The Ubuntu machine should use full-disk encryption; DB backups are encrypted.
- **Where:** `packages/crypto`.
- **Verified by:** unit tests (round-trip, tamper detection, rotation).

## 6. Server-side authentication
- **What:** Better Auth with database sessions. Next.js `middleware.ts` only redirects for UX;
  **it is never the security check** (middleware can be bypassed — CVE-2025-29927). The real
  check is `requireSession()` inside every service, Server Action and Route Handler.
- **Verified by:** for every route, a test without a session expects 401 (API) or a redirect (page).

## 7. Access control
- **What:** `requirePoolAccess` (404 for non-members, so pool existence is not confirmed) then
  `can(ctx, 'resource.action')` (403). Roles are permission sets; feature code never checks role names.
- **Verified by:** for every route, tests for: non-member → 404, member without permission → 403,
  viewer cannot write; pool-isolation tests.

## 8. Block mass assignment
- **What:** input schemas are `z.object({...}).strict()` and list only client-editable fields.
  `pool_id`, `id`, `created_by`, `role`, timestamps are never taken from the body — they come from
  the `PoolContext`/session. Repositories build insert/update objects field by field; never
  spread a request body into a query.
- **Verified by:** for every write route, a test that sends extra fields (`poolId`, `role`,
  `createdBy`) and expects 400 and no change.

## 9. Secure cookies
- **What:** session cookie `HttpOnly; SameSite=Lax; Path=/`, `Secure` whenever not on
  `localhost`, `__Host-` prefix when served over HTTPS. Only a random token in the cookie; only its
  hash in the DB. Token rotated on login and on role change.
- **CSRF:** `SameSite=Lax` plus an `Origin` check: `route()` rejects `POST`/`PUT`/`PATCH`/`DELETE`
  whose `Origin` is missing or is not the app origin (403). Server Actions are covered by Next.js'
  own origin check.
- **Verified by:** test that inspects the `Set-Cookie` header after login; `tests/web/api-route.test.ts`
  for the `Origin` check (foreign, missing, look-alike origins).

## 10. Password hashing
- **What:** argon2id (`@node-rs/argon2`) configured as Better Auth's hash/verify (its default is
  scrypt). Min length 12, max 128. Check against breached passwords (HIBP k-anonymity) on sign-up
  and password change.
- **Verified by:** unit test that the stored hash starts with `$argon2id$`; validation tests.

## 11. Rate limiting
- **What:** login and password reset: 5 attempts / 15 min per IP and per email. API: 300
  requests / min per session. Imports: 20 / hour per pool. Storage in Postgres (no Redis).
  Exceeding returns 429 with `Retry-After`.
- **Verified by:** tests that hit each limit and expect 429.

## 12. Bot protection
- **What (now):** sign-up is closed by default (`ALLOW_SIGNUP=false`); people join through invites
  (single-use token, 7 days, bound to the invited email). Rate limits (11) cover login.
- **What (when exposed to the internet):** Cloudflare Turnstile on sign-up, login and password
  reset.
- **Verified by:** test that sign-up returns 403 when `ALLOW_SIGNUP=false`.

## 13. Parameterized queries
- **What:** Drizzle query builder or the `sql` tagged template only. No string-built SQL; no user
  input in `sql.raw`/`sql.identifier`; dynamic sort/filter columns go through an allow-list.
- **Verified by:** ESLint `no-restricted-syntax` rule flagging `sql.raw(` outside
  `packages/db/**/migrations`; injection-payload test for every repository function
  (`tests/db/repository.test.ts`; the pool id in `set_config` is also tested with malicious
  strings); `/security-review`. Note: Drizzle's error message includes the query parameters, so
  errors must never be logged with their message (NES-16 redaction).

## 14. Input validation
- **What:** zod at every boundary: Server Actions, Route Handlers, query strings, route params
  (UUIDs), file contents after parsing. Reject unknown fields (8). Normalize money as strings,
  parsed to decimals.
- **Verified by:** validation-failure test per route (400 with field errors).

## 15. No data leaks
- **What:** errors returned to clients are generic (`{ error: { code, message } }`, no stack, no SQL);
  details go to logs with a `request_id`. Logs never contain amounts, IBANs, emails, tokens or
  passwords (a redaction list in the logger). No production source maps served publicly.
  Non-members get 404, not 403.
- **Where:** `route()` in `apps/web/src/server/api/route.ts` maps typed errors
  (`packages/services/src/errors.ts`) and anything unexpected to the generic body; the logger is
  `packages/services/src/logger.ts` (pino; any field whose name contains password/token/secret/session/cookie/authorization/api-key/iban/email/amount/balance/note/body/description is censored, case-insensitively and at any depth, errors logged as type, code and stack
  frames but **never the message**, because Drizzle/pg messages carry query parameters).
- **API docs exposure:** Swagger UI and the OpenAPI document are served only when
  `ENABLE_API_DOCS=true` (default false) and `NODE_ENV` is not `production`; two switches, so
  exposing them (for example on a shared box) is a conscious choice. Verified by `tests/web/openapi.test.ts`.
- **Verified by:** `tests/services/logger.test.ts` (redaction, no error message in the log) and
  `tests/web/api-route.test.ts` (a forced exception returns the generic body with a request id;
  the log has the stack, the response does not).

## 16. Restricted uploads
- **What:** max 10 MB; allow-list by **content** (magic bytes: xlsx = zip, pdf, csv text), not by
  extension or client MIME; xlsx unzip limits (entry count and uncompressed size) against zip
  bombs; files > 1 MB parsed in the worker; stored outside the web root, encrypted (5), named by
  SHA-256, original filename kept only as metadata. Never execute or render uploaded content.
  Parsing happens only in the isolated parser service (21).
- **Verified by:** importer tests with an oversized file, a renamed executable and a zip bomb.

## 17. Minimal API responses
- **What:** every response is built from an explicit zod output schema (DTO) — never return a DB
  row as-is. Never expose password/token hashes, internal flags or other pools' data. The same
  schemas feed OpenAPI.
- **Verified by:** route tests parse the response with the output schema in `strict` mode.

## 18. Security headers
- **What:** CSP with a per-request nonce (`default-src 'self'`, no `unsafe-inline` for scripts),
  `X-Frame-Options: DENY` (+ `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, mic,
  geolocation off), HSTS when on HTTPS.
- **Where:** `apps/web/src/middleware.ts` (headers only, never authorization) builds them with
  `apps/web/src/lib/security-headers.ts`; `next.config.ts` turns off `X-Powered-By` and browser
  source maps. `style-src` keeps `'unsafe-inline'` because Tailwind and `next/font` inject styles;
  scripts have none. In development only, `/api/docs` (Swagger UI) may run its bundled script.
- **Verified by:** `tests/web/security-headers.test.ts` (policy), `tests/web/headers.integration.test.ts`
  (real production build: page, API route, nonce per request, HSTS behind HTTPS, no source maps)
  and `tests/e2e/csp.spec.ts` (Playwright: no violation on the shell pages, inline handlers blocked).

## 19. HTTPS only
- **What (now):** local development over `http://localhost` through an SSH tunnel — the traffic
  between Mac and Ubuntu is encrypted by SSH. Do not expose port 4000 on the LAN without TLS.
- **What (later):** TLS terminated by the host (Render) or Caddy on a VPS; HTTP → HTTPS redirect;
  HSTS (18); `Secure` cookies (9).
- **Verified by:** deployment checklist when we leave local-only.

## 20. Dependency scanning
- **What:** `pnpm-lock.yaml` committed; `pnpm audit --audit-level=high` in CI; Dependabot for npm
  and GitHub Actions; pnpm `onlyBuiltDependencies` allow-list so dependency install scripts do not
  run by default; new dependencies justified in the PR.
- **Verified by:** CI job `security.yml`; Dependabot PRs.

## 21. Parser isolation and AI safety
- **What:** see `docs/adr/0001-ai-assisted-importers.md`.
  - The parser service (`services/parser`) has no DB credentials, no object-storage access and no
    outbound network (internal Docker network only); runs non-root, read-only filesystem, with CPU,
    memory and time limits per job and regex timeouts.
  - Only reviewed code runs: new code parsers enter through a PR. AI output is **data** (an import
    spec validated against a strict, versioned JSON schema), never executed code.
  - Only synthesized structure (headers, layout, fake sample rows) is sent to the AI provider —
    never the statement, names, IBANs or real amounts. The AI API key is server-side only (1).
  - AI-generated specs start as `draft` (creating pool only) and become global only after
    reconciled, confirmed imports or admin approval; failing global specs are demoted.
  - AI generation is rate-limited per pool and globally, requires `imports.run`, and is audited
    (without file content).
- **Verified by:** docker-compose review (no network/volumes for the parser container); tests that
  the synthesizer output contains none of the original values; spec-schema rejection tests
  (unknown keys, unbounded regex, oversized patterns); promotion-rule unit tests.

---

## How this is enforced

1. **This file + `CLAUDE.md`** — the rules Claude reads every session.
2. **Skills** — `protected-route` and `db-migration` generate code and tests that implement
   controls 4, 6–9, 11, 13–15, 17; `finish-task` walks this list and runs `/security-review`
   before every PR.
3. **Automated checks** — tests listed under "Verified by", plus `.github/workflows/security.yml`
   (gitleaks, `pnpm audit`, lint, tests) on every push and PR.
4. **PR template** — the security section must be filled in; a PR cannot be merged with an
   unchecked control that applies to it.
