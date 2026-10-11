# Security baseline

Twenty controls every change must respect. Each control says **what** we do, **where** it lives and
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

---

## 1. Keep API keys server-side
- **What:** third-party keys (`PRICES_API_KEY`, email) are read only on the server (worker, services).
  Never use the `NEXT_PUBLIC_` prefix for a secret; never import `env` server modules into client components.
- **Where:** `packages/config/env.ts` (zod-validated env, `import 'server-only'`).
- **Verified by:** CI step that fails if any `NEXT_PUBLIC_*` variable name matches
  `KEY|SECRET|TOKEN|PASSWORD`; `server-only` import makes a client import a build error.

## 2. No secrets in git
- **What:** `.env*` files are ignored (only `.env.example` is committed, with placeholders).
  If a secret is ever committed, **rotate it** — rewriting history is not enough.
- **Where:** `.gitignore`, `.github/workflows/security.yml`.
- **Verified by:** gitleaks on every push and PR; Claude is denied reading `.env*` files
  (`.claude/settings.json`).

## 3. No database credentials reachable by clients
- **Why adapted:** the original advice is about Supabase/Firebase "public" keys used from the
  browser. We have no such key: the browser never talks to Postgres.
- **What:** Postgres is only reachable by the server. In `docker-compose.yml` the port is bound to
  `127.0.0.1` (access from the Mac through the SSH tunnel). DB URLs only in server env.
- **Verified by:** review of `docker-compose.yml` in `finish-task`; control 1 checks.

## 4. Row-Level Security
- **What:** every table in `nestvault_app` has `pool_id uuid not null`, `ENABLE` **and** `FORCE ROW
  LEVEL SECURITY`, and a policy `pool_id = current_setting('app.pool_id')::uuid`. The app connects as
  `app_rw` (not table owner, no `BYPASSRLS`). Queries run in `withPool(ctx, …)` which does
  `SET LOCAL app.pool_id`.
- **Where:** `packages/db/app/migrations`, `packages/db/app/with-pool.ts`.
- **Verified by:** a test that queries `pg_class` and fails if any app table (except the global
  `fx_rates`) lacks `relrowsecurity` and `relforcerowsecurity`; pool-isolation tests for every
  repository (read and write of another pool's row must fail, even with the `where` removed).

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
- **Verified by:** test that inspects the `Set-Cookie` header after login.

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
  `packages/db/**/migrations`; injection-payload test for every repository function;
  `/security-review`.

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
- **Verified by:** logger redaction unit test; error-handler test that forces an exception and
  checks the body.

## 16. Restricted uploads
- **What:** max 10 MB; allow-list by **content** (magic bytes: xlsx = zip, pdf, csv text), not by
  extension or client MIME; xlsx unzip limits (entry count and uncompressed size) against zip
  bombs; files > 1 MB parsed in the worker; stored outside the web root, encrypted (5), named by
  SHA-256, original filename kept only as metadata. Never execute or render uploaded content.
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
- **Where:** `apps/web/middleware.ts` + `next.config.ts`.
- **Verified by:** test that requests a page and an API route and asserts each header.

## 19. HTTPS only
- **What (now):** local development over `http://localhost` through an SSH tunnel — the traffic
  between Mac and Ubuntu is encrypted by SSH. Do not expose port 3000 on the LAN without TLS.
- **What (later):** TLS terminated by the host (Render) or Caddy on a VPS; HTTP → HTTPS redirect;
  HSTS (18); `Secure` cookies (9).
- **Verified by:** deployment checklist when we leave local-only.

## 20. Dependency scanning
- **What:** `pnpm-lock.yaml` committed; `pnpm audit --audit-level=high` in CI; Dependabot for npm
  and GitHub Actions; pnpm `onlyBuiltDependencies` allow-list so dependency install scripts do not
  run by default; new dependencies justified in the PR.
- **Verified by:** CI job `security.yml`; Dependabot PRs.

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
