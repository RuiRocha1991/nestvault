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
- **Holders (NES-38)** are the first `nestvault_app` table: `holders` follows the block above
  (`pool_id`, FORCE RLS, `holders_pool_isolation`, grants to `app_rw`) and its repository takes a
  `PoolContext` for every function. The link to a user (`user_id`) is an id only, because the two
  databases are never joined: `HoldersService` checks in the identity database that the user is a
  member of the same pool before writing (400 otherwise; a member is at most one holder, 409).
  Every member of the pool is a holder: listing or writing first runs `ensureMemberHolders`, which
  reads the membership in the identity database and inserts the missing holders (idempotent,
  `ON CONFLICT DO NOTHING` on the unique `(pool_id, user_id)`), so a request never sees another
  pool's people; a holder outlives its member, and the holder of a current member cannot be
  removed (409). Writes need `accounts.write` and are audited (`holder.created`, `holder.updated`,
  `holder.deleted`, target id only; names and aliases never reach the log). Verified by
  `tests/db/holders.repo.integration.test.ts` (`expectIsolated` for every function, RLS without a
  `where`, `WITH CHECK`, injection payloads in name and aliases, check constraints),
  `tests/services/holders.integration.test.ts` (guards in order, mass assignment, other pool's ids,
  audit entries) and the generated route cases for `/holders` in `tests/support/route-registry.ts`.
- **Pool settings and FX rates (NES-46)**: `pool_settings` (one row per pool, unique on `pool_id`)
  follows the same block (FORCE RLS, `pool_settings_pool_isolation`, repository on a `PoolContext`).
  `fx_rates` is the global exception: no `pool_id`, no RLS, and the migration takes every write
  privilege back from `app_rw` (`REVOKE ALL`, then `GRANT SELECT`); its only writer is the migration
  (a worker role fills it later), so a pool cannot alter a rate another pool reads. Reads need
  `pool.read`, writes `settings.write` (owner, admin), and a save is audited as `settings.updated`
  (target = the pool, meta = number of fields; values never reach the log). The input is strict
  (taxes 0–100, rates positive with at most 8 decimals, window 0–30 days, EUR has no rate) and
  decimals stay strings. Verified by `tests/db/pool-settings.repo.integration.test.ts` (isolation,
  RLS, constraints, injection payloads, and `app_rw` refused on insert, update and delete of
  `fx_rates`), `tests/services/settings.integration.test.ts` (guards in order, validation, audit
  without values, per-pool overrides) and the generated route cases for `/settings` and `/fx`.
- **Accounts (NES-39)**: `accounts`, `account_holders` and `sub_accounts` follow the block above
  (`pool_id`, FORCE RLS, one `*_pool_isolation` policy each, repositories on a `PoolContext`). The
  foreign keys are composite `(pool_id, id)`, so a link cannot name another pool's person or
  account even without RLS; holders are `ON DELETE RESTRICT`, accounts cascade to their links and
  sub-accounts. The IBAN is normalized, checked with mod-97 in `packages/domain` and unique per
  pool (partial unique index); it is returned only inside the pool's own DTO and never reaches the
  audit log or the logs (`account.*` actions carry the id as target and no meta). Reads need
  `pool.read`, writes `accounts.write` (owner, admin); input is strict (no `poolId`/`id`), money
  and rates are decimal strings, a term deposit is EUR (also a CHECK). Verified by
  `tests/db/accounts.repo.integration.test.ts` (`expectIsolated` for every function, RLS without a
  `where`, `WITH CHECK`, composite foreign keys, injection payloads, constraints),
  `tests/services/accounts.integration.test.ts` (guards in order, IBAN rules, Banco Invest case,
  mass assignment, other pool's ids, audit without values) and the generated route cases for
  `/accounts` and `/sub-accounts` in `tests/support/route-registry.ts`.
- **Assets and prices (NES-41)**: `assets` and `asset_prices` follow the block above (`pool_id`,
  FORCE RLS, one `*_pool_isolation` policy each, repositories on a `PoolContext`); a price points at
  `(pool_id, asset_id)` through a composite foreign key, so it cannot name another pool's asset even
  without RLS. The ticker is unique per pool and validated against an allow-list pattern; prices
  are decimal strings (`numeric(18,6)`, positive) and a bulk update is one `INSERT … ON CONFLICT`
  inside one `withPool` transaction after every entry has been validated (tickers resolved in the
  URL's own pool only), so a bad entry stores nothing. Assets need `portfolios.write` (owner,
  admin), prices `prices.write` (members too), reads `pool.read`; writes are audited (`asset.*`,
  target id and a count only, never names or prices). Verified by
  `tests/db/assets.repo.integration.test.ts` (`expectIsolated` for every function, RLS without a
  `where`, composite foreign key, injection payloads, constraints),
  `tests/services/assets.integration.test.ts` (guards in order, atomic bulk, other pool's ids, audit
  without values) and the generated route cases for `/assets` and `/asset-prices`.
- **Categories (NES-94, ADR 0004)**: `categories` is the one table with a nullable `pool_id`: global
  rows (`pool_id` null, `system_key`, no name) are the shared catalogue, written by the migration
  only; a pool's own rows carry its `pool_id` and a `name` (a CHECK forbids any mix). RLS uses one
  policy per command: `SELECT` shows global rows and the pool's own, while `INSERT`, `UPDATE` and
  `DELETE` need `pool_id = app_current_pool_id()`. A single `FOR ALL` policy with the rule from the
  ADR would let a pool turn a global row into its own through an `UPDATE` (its `USING` passes for
  global rows and its `WITH CHECK` for the new row), so it is not used; the table is FORCE row
  secured, so the seed in the migration lifts FORCE for its own insert only. `pool_category_settings`
  (budget, colour, hidden) follows the usual per-pool block and its `WITH CHECK` also requires the
  category to be visible through RLS, which closes what a plain foreign key cannot (a global row has
  no pool). Pools write with `categories.write` (owner, admin); a global category answers 403 to an
  update or a delete; writes are audited (`category.*`, target id and a count, never names or
  budgets). Verified by `tests/db/categories.repo.integration.test.ts` (the 25 defaults, no copy per
  pool, raw `UPDATE`/`DELETE`/"steal" and a `pool_id` null insert refused, another pool's category
  invisible, settings pointing at another pool's category refused, injection payloads, CHECKs),
  `tests/services/categories.integration.test.ts` and the generated route cases for `/categories`.
- **Transactions and rules (NES-44)**: `transactions` and `category_rules` follow the block above
  (`pool_id`, FORCE RLS, repositories on a `PoolContext`). The account is a composite foreign key
  `(pool_id, account_id)`; the category (global or the pool's own, so no pool id to include) is a
  plain foreign key plus a row policy whose `WITH CHECK` requires the category to be visible through
  RLS, so a pool cannot attach a movement or a rule to another pool's category even by raw SQL.
  Accounts and categories in use are protected by `ON DELETE RESTRICT`. Lists sort and filter only
  through allow-lists (`z.enum` of `date|amount|description`, filter keys, kinds): the column
  comes from a map in the repository, never from the request; pagination is a keyset cursor that
  names its sort (another sort's cursor answers 400); the text search escapes `%`, `_` and `\`
  and is a bound parameter. A transaction written by hand needs `transactions.write` (members too),
  rules need `categories.write`; writes are audited (`transaction.*`, `rule.*`, target id and a
  count, never descriptions, keywords or amounts). Verified by
  `tests/db/transactions.repo.integration.test.ts` (`expectIsolated` for every function, RLS,
  composite and visibility checks, injection payloads, escaped LIKE, keyset paging, 20 000 rows in
  under 150 ms), `tests/services/transactions.integration.test.ts`,
  `tests/services/rules.integration.test.ts` and the generated route cases for `/transactions` and
  `/rules`.
- **Portfolios, operations and plans (NES-42)**: `portfolios`, `investment_ops` and `plans` follow
  the block above (`pool_id`, FORCE RLS, repositories on a `PoolContext`). Every reference is a
  composite foreign key `(pool_id, …)`, and a sub-account must belong to the operation's account
  `(pool_id, account_id, sub_account_id)`, so a row cannot name another pool's portfolio, asset,
  account or sub-account even by raw SQL; the service checks the same first and answers 400. The
  per-type rules (quantity above zero, price, dividend amount) are check constraints as well as zod
  rules. `(pool_id, account_id, ext_id)` and `(pool_id, plan_id, plan_period)` are unique, so an
  import cannot duplicate an operation and a plan cannot register two buys in a month, even when two
  runs race. Deleting a portfolio with operations answers 409 unless they are moved or deleted;
  `extId`, `planId` and the pool never come from the request. Portfolios and plans need
  `portfolios.write`, operations and plan runs `ops.write`; writes are audited (`portfolio.*`,
  `op.*`, `plan.*`, target id only, never amounts or notes). Verified by
  `tests/db/investments.repo.integration.test.ts` (`expectIsolated` for every function, composite
  keys, checks, injection payloads), `tests/services/investments.integration.test.ts` and the
  generated route cases for `/portfolios`, `/ops` and `/plans`.
- **Savings products, deposits and interest (NES-40)**: `savings_products`, `deposits` and
  `interest_entries` follow the block above (`pool_id`, FORCE RLS, repositories on a `PoolContext`).
  Every reference is a composite foreign key `(pool_id, …)`: the deposit's account, its product and
  the accounts that receive the interest or fund it cannot belong to another pool even by raw SQL,
  and they are restricted, so an account a product, deposit or interest entry names cannot be
  deleted (the service answers 409 first). A deposit goes with its account. Rate and tax are check
  constraints (0-100) as well as zod rules (up to 4 decimals), and a period always has its number
  and its unit. There is one deposit per account (unique `(pool_id, account_id)`). All three need
  `accounts.write` to change; the pool and ids never come from the body; writes are audited
  (`product.*`, `deposit.*`, `interest.*`, target id only, never amounts or notes). Verified by
  `tests/db/savings.repo.integration.test.ts` (`expectIsolated` for every function, composite keys,
  checks, injection payloads), `tests/services/savings.integration.test.ts` and the generated route
  cases for `/products`, `/deposits` and `/interest`.
- **Notes (NES-45)**: `month_notes` follows the block above (`pool_id`, FORCE RLS, unique
  `(pool_id, month)`, `month` must be a first day, body 1-10 000 characters). The note columns of
  `transactions` and `investment_ops` (2 000 characters) are written only by `notesRepo`, and the
  import insert is `ON CONFLICT DO NOTHING`, so a re-import never touches a note. A note is user
  content: zod trims it, rejects control characters and unknown fields (author and time come from
  the session), and it is searched with an escaped `ILIKE` (`%`, `_` are data). Writes need
  `notes.write` (viewers get 403); a month note uses optimistic locking, and the 409 body carries
  the current version, which the caller may read anyway. The audit entry (`note.updated`) holds
  the row id only, and the logger redacts `note` and `body`. Verified by
  `tests/db/notes.repo.integration.test.ts` (`expectIsolated` for every function, checks, injection
  payloads, re-import keeps the note), `tests/services/notes.integration.test.ts` (roles,
  lengths, 409, audit without text) and the generated route cases for `/note` and `/months`.
- **Portfolio cash moves (NES-43)**: `portfolio_cash_moves` follows the block above (`pool_id`,
  FORCE RLS, repository on a `PoolContext`). The portfolio, the receiving account and the bank
  movement are composite foreign keys `(pool_id, …)`, so none can belong to another pool even by
  raw SQL; the account is restricted (409 first) and the portfolio's moves must be moved or deleted
  with it. Moving cash and undoing a move need `ops.write`; the pool and portfolio come from the
  URL, never the body, and the body is strict. The amount check and the mirror movement share one
  database transaction. Writes are audited (`cashmove.*`, target id only, never amounts or notes).
  Verified by `tests/db/portfolio-cash-moves.repo.integration.test.ts` (`expectIsolated` for every
  function, composite keys, checks, injection payload), `tests/services/cash-moves.integration.test.ts`
  and the generated route cases for `/portfolios/:id/cash-moves`.

## 5. Encryption of sensitive data
- **What:** in transit — HTTPS when not local (see 19). At rest — AES-256-GCM with
  `APP_ENCRYPTION_KEY` (key id stored with the ciphertext so the key can rotate) for: original
  imported statement files and, later, TOTP secrets. Amounts and dates stay in clear (they are
  queried and aggregated); IBANs are stored in clear but never logged (decision to revisit).
  The Ubuntu machine should use full-disk encryption; DB backups are encrypted.
- **Where:** `packages/crypto` (`encrypt`, `decrypt`, `rotate`, `parseKeyRing`). The blob is
  `[format][key id length][key id][iv 12][ciphertext][tag 16]`; the header and a caller context
  (the pool and the file hash) are authenticated, so a file copied under another name or into
  another pool does not decrypt. `APP_ENCRYPTION_KEY` is one base64 key (id `k1`) or a list
  `new:<key>,old:<key>` whose first entry encrypts: rotating means putting the new key first and
  dropping the old one once `rotate` has re-encrypted every file. The uploaded statements are
  stored by `packages/services/src/imports/storage.ts` under `IMPORT_STORAGE_DIR` (outside the web
  root, one folder per pool, `<sha256>.bin`, files `0600`, folders `0700`, written beside the
  target and renamed).
- **Verified by:** unit tests (round-trip, a flipped bit in any byte of the blob, truncation, wrong
  context, wrong key, rotation, key-list parsing: `tests/crypto/aes-gcm.test.ts`; the file store:
  not readable on disk, not readable without the key, readable after a rotation, copied file
  refused, ids never reach the file system as a path: `tests/services/imports-storage.test.ts`).

## 6. Server-side authentication
- **What:** Better Auth with database sessions. Next.js `middleware.ts` only redirects for UX;
  **it is never the security check** (middleware can be bypassed — CVE-2025-29927). The real
  check is `requireSession()` inside every service, Server Action and Route Handler.
- **Pages:** the `(app)` layout reads the session from the database (`getCurrentSession`) and
  redirects to `/login?next=…`; `/login` redirects signed-in users into the app. `next` goes through
  `safeNextPath` (same-origin relative paths only, never `/login`), so the sign-in page cannot be used
  as an open redirect. Wrong password and unknown email get the same answer (and Better Auth hashes a
  dummy password for an unknown email), so neither the message nor the timing reveals which accounts exist.
- **Verified by:** for every Route Handler, a generated test without a session expects 401 (the
  isolation suite, see control 7; a page expects a redirect);
  `tests/e2e/login.spec.ts` (redirect with `next`, open-redirect payloads, identical error, sign-out
  kills the cookie), `tests/e2e/session.spec.ts` (a revoked or expired session is sent to the
  sign-in screen with the expiry message), `tests/services/safe-next-path.test.ts`, and
  `tests/services/auth.integration.test.ts` (same status and body, comparable timing).

- **Password reset and email verification (NES-22):** `/recuperar` always answers with the same
  neutral screen and the API with the same body, whether or not the account exists; the email is
  sent in the background so the timing does not tell either. The reset link opens
  `/recuperar/{token}`: the token is 24 random characters, single use, valid for 1 hour and stored
  only as a hash (`verification.storeIdentifier: 'hashed'`); using it ends every session of the user
  and sends a "password changed" notice. The verification link (`/verificar/{token}`) is a signed
  token valid for 24 hours. Emails are built from pt-PT templates that escape every interpolated
  value (`packages/services/src/email/`); the sender never logs the recipient, the subject or the
  body (the links carry tokens), and the web process logs only the error type of a failed delivery.
  SMTP needs TLS whenever it logs in or the host is not loopback. The pages whose address carries a token (`/recuperar/{token}`, `/verificar/{token}`) send `Referrer-Policy: no-referrer`. Requests are rate limited by control 11 (resending the verification email has its own bucket, so it never uses up a reset).
- **Verified by:** `tests/services/password-reset.integration.test.ts` (link works once, expired
  token, identical answer for unknown email, sessions ended, token hashed and absent from logs and
  console, forged verification token), `tests/services/email.test.ts` (escaping, TLS, no recipient in
  the log), `tests/e2e/password-reset.spec.ts` (full flow through Mailpit in both themes).

- **Sign-up (NES-105):** `/registar` (screen 50) is open only with `ALLOW_SIGNUP=true`; closed, it
  shows screen 51 and the API answers 403 `signup_closed`. Better Auth runs with
  `requireEmailVerification`: sign-up creates an unverified account and **no session**, sends the
  verification link, and sign-in answers 403 `EMAIL_NOT_VERIFIED` (and sends a new link) until it is
  used, so the app cannot be used before verifying. Registering an address that already has an
  account answers exactly like a new one (same status and body shape, a dummy password hash keeps the
  timing close) and the owner is told by email ("Já tens uma conta"): no account enumeration. Using
  a password-reset link also confirms the address. The server enforces the password rules: 12 to 128
  characters, not a common password (`PASSWORD_TOO_COMMON`), not based on the email
  (`PASSWORD_BASED_ON_EMAIL`: the address, or its name part with accents folded and without dots or a
  `+tag`; a name of 6+ characters is always refused, one of 3 to 5 only when the rest of the password
  has fewer than 6 different characters), not in a known breach. The rules are one list (`PASSWORD_RULES` in
  `@nestvault/services/password-policy`): the Better Auth hook applies it to sign-up, change-password
  and reset-password (the email comes from the body, the session or the reset token's user; a rule
  that needs an email is skipped when it cannot be told), and the forms show the same list as
  guidance only. Sign-up is rate limited like sign-in
  (control 11).
- **Verified by:** `tests/services/signup.integration.test.ts` (no session, verification email, 403
  until verified, identical answer for an existing email and the warning mail, closed, password
  rules, injection payload as data, 6th sign-up is 429, reset confirms the address),
  `tests/web/password-strength.test.ts`, `tests/e2e/signup.spec.ts` (closed and open servers, both
  themes).
- **Account page (NES-24):** `/conta` and `/api/v1/me*` belong to the signed-in user and are outside
  every pool. Each service function starts with the session, and every session query filters by the
  caller's `userId` (`sessionsRepo`), so the id of another user's session matches nothing and answers
  404 (like an unknown or malformed id). The sessions list is built from an output schema with no
  token, no token hash and a masked IP (`85.240.x.x`). Changing the password (`revokeOtherSessions`)
  ends every other session and emails a notice; changing the email sends the link to the **new**
  address and only changes it once the link is used (an address already in use answers the same).
- **Verified by:** `tests/services/account.integration.test.ts` (sessions of the user only, 404 for
  another user's id and an injection payload, ended cookie dies at once, no token or full IP in the
  DTO, change-password limit and notice, change-email flow), `tests/web/me-route.test.ts` (401 on
  every endpoint, `others=true` required, Origin check), `tests/e2e/account.spec.ts`.

## 7. Access control
- **What:** `requirePoolAccess` (404 for non-members, so pool existence is not confirmed) then
  `can(ctx, 'resource.action')` (403). Roles are permission sets; feature code never checks role names.
- **Where:** `packages/services/src/guards` (`permissions.ts` holds the catalogue and the
  role → permission sets from PRD 01; `pool-access.ts` has `requirePoolAccess`, `can` and
  `systemContext`). Membership is read from `pool_members` in the identity database with bound
  parameters. A malformed id, a missing pool and a pool the caller is not in all throw the same
  `NotFoundError`; the session's `active_pool_id` is updated on a successful access only.
- **Verified by:** the generated pool-isolation suite (NES-30): `tests/web/route-isolation.integration.test.ts`
  calls every Route Handler of `tests/support/route-registry.ts` with real sessions, services and
  Postgres, and checks non-member → 404 (identical to an unknown or malformed pool), a role below
  the permission → 403 (and the lowest role holding it succeeds, so a wrong permission in the
  registry fails), a resource id of another pool or user → 404 and unchanged, and no pool B data in
  any response. `tests/web/route-registry.test.ts` fails CI when a Route Handler is not in the
  registry. At repository level `expectIsolated()` (`tests/support/expect-isolated.ts`) runs a
  function as pool A against pool B data (`tests/db/expect-isolated.integration.test.ts`); both are
  described in `docs/testing.md`. Timing of the 404 paths is not asserted by the suite (the
  guard order makes them identical; `pool-access.integration.test.ts` covers the cases). `tests/services/permissions.test.ts` compares the
  matrix with the PRD table; `pool-access.integration.test.ts` covers identical 404s (also for
  injection payloads and timing) and the active pool; the ESLint rule `noRoleComparison` rejects
  `role ===` / `switch (x.role)` outside the context factory (`tests/lint/rules.test.ts`).
- **Audit log:** security-relevant actions are written to the insert-only `audit_log` table in the
  identity database (`packages/services/src/audit`: `recordAudit` for pool actions, with pool and
  actor taken from the `PoolContext`; `recordAccountAudit` for sign-in, failed sign-in, password
  change and session revocation, wired into the Better Auth hooks and the account service). The
  migration revokes UPDATE, DELETE and TRUNCATE from `identity_rw` (layer 1: privileges), and
  `0005_audit_log_insert_only_trigger` adds a `BEFORE UPDATE OR DELETE` row trigger and a
  `BEFORE TRUNCATE` trigger that raise `audit_log is insert-only` for every role, the owner
  included (layer 2: a later `GRANT ALL`, `ALTER DEFAULT PRIVILEGES` or inheriting role cannot
  restore the ability to rewrite history); the table has no foreign keys, so no cascade can erase
  history. `meta` keeps only allow-listed keys (`ALLOWED_META_KEYS`, among them `actorRole`: the role the caller holds
  **after** the action, not before it; `pool.ownership_transferred` records the new owner in `role`
  and the caller's own role afterwards in `actorRole`, so a demotion shows as `admin`) with
  short codes, numbers or booleans, so amounts, IBANs, notes, emails and tokens cannot get in; the
  target must be an id, the placeholder for an unknown address is not stored. A failed account
  entry is logged and never blocks the user; a pool entry throws, so the action does not look done.
  Failed sign-ins carry no user (looking the address up would leak by timing). Only the owner
  (`audit.read`) can list a pool's entries (`listAuditLog`, addresses masked). Verified by
  `tests/services/audit.integration.test.ts` (UPDATE/DELETE/TRUNCATE refused, one entry per
  action, forbidden meta dropped, injection payloads, 403 for non-owners, pool isolation) and
  `tests/services/audit-meta.test.ts`; layer 2 by `tests/db/audit-log-trigger.integration.test.ts`
  (UPDATE/DELETE/TRUNCATE fail with the trigger error, not `permission denied`, even for the table
  owner, who holds those privileges; both triggers exist and are enabled; INSERT and reads work).
  **Retention:** nothing deletes audit entries automatically. If entries older than the retention
  period (default 730 days) must go, the migration user (never the application) runs, in one
  transaction: `BEGIN; ALTER TABLE audit_log DISABLE TRIGGER audit_log_reject_row_rewrite;
  DELETE FROM audit_log WHERE at < now() - interval '730 days'; ALTER TABLE audit_log ENABLE
  TRIGGER audit_log_reject_row_rewrite; COMMIT;`. The DISABLE is transactional and takes an
  exclusive lock, so no other session sees the table unprotected, and an aborted run leaves the
  trigger enabled. The test suite resets the identity database the same way (TRUNCATE with both
  triggers disabled, in a transaction). The procedure is tested in
  `tests/db/audit-log-trigger.integration.test.ts`; a direct DELETE fails, the same DELETE inside
  the procedure removes only the old row. A partitioned table was rejected as too heavy for
  household scale.
- **Audit screen (NES-120):** `/[poolId]/definicoes/auditoria` reads through `AuditService.screen`
  (session → strict query → `requirePoolAccess` 404 → `audit.read` 403; the page turns both
  into the 404 page, and `definicoes/auditoria/layout.tsx` gives the real 404 status before the
  skeleton streams). The URL filters (`action`, `person`, `range`, `from`, `to`, `page`) are parsed
  with fallbacks and re-validated by the service (`category` and `action` are enums, `person` a
  uuid, `page` ≤ 10 000); queries use bound parameters only. Names are looked up only for ids on
  the returned page plus the pool's current members, never emails; everything is rendered as
  React text. The screen has no write path and no export. Verified by
  `tests/services/audit-screen.integration.test.ts` (filters, paging, 401/400/404/403 order, no
  names of other pools, injection payloads on the new repository functions),
  `tests/web/audit-screen.test.tsx` (escaping, read-only, tabs by permission) and
  `tests/e2e/audit.spec.ts` (owner flows, 404 for admin, member and outsiders, hostile name).
- **Creating a pool (NES-26):** `POST /api/v1/pools` has no membership to check yet, so its guards
  are the session (401), the strict one-field body (400 for `role`, `id`, `ownerId`…), the `Origin`
  check, the `api` rate limit and a cap of 10 owned pools per user (409). The owner is always the
  session user. `createPool` writes the pool, the owner membership and the `pool.created` audit
  entry in **one transaction**: `recordAudit` takes the transaction, so a pool never exists without
  its owner or its entry (a failing audit insert rolls everything back). Every `/[poolId]` page
  calls `requirePoolAccess` through `PoolsService.open`, so a pool of somebody else, an unknown id
  and a malformed one all render the same 404. Pool names are 1-60 characters without control
  characters, stored as data and escaped by React. Verified by `tests/services/pools.integration.test.ts`
  (owner, rollback, 401, validation, cap, other users' pools, injection payloads), `tests/web/pools-route.test.ts`
  and `tests/e2e/pools.spec.ts`.

- **Invites (NES-27):** `POST /api/v1/pools/{poolId}/invites` (and list, resend, cancel) go through
  the full chain: session (401), strict `{ email, role }` body (400 for `poolId`, `id`, `invitedBy`…),
  `requirePoolAccess` (404), `members.invite` (403), `canAssignRole` (no role above the inviter's: an
  admin cannot invite an owner, 403; resending or cancelling an owner invite is the same), the
  `invites` rate limit (20 a day per pool, 429), then one transaction that writes the invite and the
  `invite.created` entry. The token is 32 random bytes (base64url, 256 bits), shown only in the email
  link; the table stores its SHA-256 hash, so a database leak gives no working links, and neither the
  audit log nor the access log ever holds it (`route()` logs `/api/v1/invites/:token/accept`). One
  pending invite per pool and address (partial unique index; a new one replaces the old, whose link
  stops working); the address is `citext`, so case does not matter. `accept` (`POST
  /api/v1/invites/{token}/accept`) needs a session whose **verified** email equals the invite's; an
  unknown, expired, used or someone else's token and an unverified address all answer the same 404.
  Single use: `markAccepted` (`where accepted_at is null and expires_at > now`) and the membership are
  written in one transaction, so of two parallel accepts one wins. The public page `/convite/{token}`
  (screens 58-61) shows pool, inviter, address and role only to whoever holds the link, answers
  screen 61 with no names for any invalid link, sends `Referrer-Policy: no-referrer` and looks the
  token up under a per-IP limit (`invites.lookup`, 60 a minute). Registering through an invite
  (`/convite/{token}/registar`) sends the token in the `x-invite-token` header, which the sign-up
  hook checks against the same table (control 12); the account still has to confirm its email.
- **Verified by:** `tests/services/invites.integration.test.ts` (roles, 401/403/404, validation and
  mass assignment, replace, 409 for a member, 20 a day, hash only, audit entries, cancel and resend
  with another pool's id, expired/used/different-address/unverified/parallel accepts, sign-up through
  invites, isolation and injection payloads for every repository function),
  `tests/services/invite-tokens.test.ts`, `tests/services/permissions.test.ts` (`canAssignRole`),
  `tests/web/invites-route.test.ts` (401, Origin, 413, extra fields, error mapping),
  `tests/web/api-route.test.ts` (token not logged) and `tests/e2e/invite.spec.ts`.
- **Members (NES-28):** `GET …/members`, `PATCH` and `DELETE …/members/{userId}`, `POST …/transfer`
  and `POST …/leave` go through the chain: session (401), strict body (`{ role }`, or `{ userId,
  password, keepOwnership? }`; `poolId`/`userId` in the PATCH body answer 400, they come from the
  URL), `requirePoolAccess` (404), then the permission (`members.manage`, `pool.transfer`; leaving
  and listing need membership only), then one transaction that **locks the pool's membership rows**
  (`SELECT … FOR UPDATE`), reads the caller's role again from the locked rows and applies the rules
  from `guards/permissions.ts`: nobody acts on themselves, only an owner touches an owner
  (`canActOnMember`), nobody hands out a role above their own (`canAssignRoleAs`), and a pool never
  loses its last owner (`leavesNoOwner`, 409). The locks make two owners demoting or leaving each
  other at once leave exactly one winner. Rules compare permissions, never role names (the lint rule
  stays on). Access is checked per request against the database, so a changed or removed membership
  applies to the very next call (a removed person gets 404); role changes and removals also delete the
  person's sessions that were working in the pool. The change and its audit entry
  (`member.role_changed`, `member.removed`, `member.left`, `pool.ownership_transferred`, ids and role
  codes only) share the transaction. Handing over the pool, and making somebody an owner through
  `PATCH` (`{ role: 'owner', password }`; the password is not read for other roles), need the caller's **password**,
  verified against the stored argon2id hash and counted in the account's password bucket
  (`auth.account.user`, 5 / 15 min, 429; a success gives its hit back); the password is never logged
  or echoed. When it is required: the order of answers is 401, 400 (malformed body), 404 (not a
  member), **403 first** for a caller without the permission and for an admin trying to make an
  owner, then the cheap unlocked checks: an unknown person is **404** and a person who already holds
  the role is a **no-op** (promotion) or **409** (transfer), all answered **before** the password is
  read or any rate-limit hit or argon2 verification is spent. Only a real promotion or transfer asks
  for it, and then a missing or wrong password answers **400** with an issue on `password` only
  (429 after five wrong guesses). If the role changed between the unlocked check and the lock, the
  locked transaction refuses to make an owner that was not confirmed (409, try again). `GET …/members` fills
  emails only for `members.manage`, and the DTO adds `owner` and `editable` flags so the screen never
  compares roles itself (hiding stays cosmetic; every service re-checks). `lastActivityAt` is the
  newest activity of the member's **unexpired** sessions that are working in this pool; activity in
  another pool is never shown, so a pool does not learn when its members were active elsewhere.
  **Leaving** removes the membership, clears the active pool of the leaver's sessions in this pool and
  audits it; the leaver's sessions in other pools stay, and the invites they sent stay valid, because
  an invite belongs to the pool, not to the person who sent it (the owner can cancel it from the
  pending list at any time).
- **Verified by:** `tests/services/members.integration.test.ts` (list visibility and flags, role
  changes with sessions ended and permissions applied at once, admin vs owner, self, last owner,
  parallel demotions and leaves, removal, leave, transfer with wrong password, 429 and keep-ownership, no password spent on 404/no-op/409,
  `lastActivityAt` following the injected clock,
  mass assignment, other pool's ids, 401/403/404, repository isolation and injection payloads),
  `tests/services/member-rules.test.ts` (the rule helpers), `tests/web/members-route.test.ts` (401,
  Origin, 413, extra fields, error mapping, no password echo), `tests/web/members-screen.test.tsx`
  (controls by role, escaping), `tests/lint/rules.test.ts` (no role comparisons) and
  `tests/e2e/members.spec.ts`.
- **Open decision (NES-125): admin acting on admin.** PRD 01 gives admins `members.invite` and
  `members.manage` "(not owners)" and says only "an admin cannot remove or demote an owner"; it says
  nothing about admins acting on other admins. Current behaviour, pinned by `canActOnMember` in
  `tests/services/member-rules.test.ts` (`admin` -> `admin`: true): an admin may change the role of,
  or remove, another admin; only owners are protected. Restricting it (admin acts only on roles
  strictly below admin) is a product decision that has not been taken; until it is, this is the
  documented behaviour, not an accident.

## 8. Block mass assignment
- **What:** input schemas are `z.object({...}).strict()` and list only client-editable fields.
  `pool_id`, `id`, `created_by`, `role`, timestamps are never taken from the body — they come from
  the `PoolContext`/session. Repositories build insert/update objects field by field; never
  spread a request body into a query.
- **Verified by:** for every route that reads a body, the isolation suite sends each of `poolId`,
  `id`, `role`, `createdBy`, `userId`, `ownerId` and `email` that the route does not legitimately
  take, and expects 400 `validation_error` (`tests/web/route-isolation.integration.test.ts`).

## 9. Secure cookies
- **What:** session cookie `HttpOnly; SameSite=Lax; Path=/`, `Secure` whenever not on
  `localhost`, `__Host-` prefix when served over HTTPS. Only a random token in the cookie; only its
  hash in the DB. Token rotated on login and on role change.
- **CSRF:** `SameSite=Lax` plus an `Origin` check: `route()` rejects `POST`/`PUT`/`PATCH`/`DELETE`
  whose `Origin` is missing or is not the app origin (403). Server Actions are covered by Next.js'
  own origin check.
- **Where:** `packages/services/src/auth/create-auth.ts` (cookie `nv.session_token`, 30 days
  sliding, cookie cache off so revocation is immediate); the token hash is stored by
  `hashed-session-adapter.ts` (SHA-256; the hash is useless as a credential).
- **Verified by:** `tests/services/auth.integration.test.ts` (`Set-Cookie` attributes after login,
  only the SHA-256 stored, the stored hash rejected as a cookie, `Secure` and the `__Secure-`
  prefix only on https, sliding renewal after the update age, expired sessions rejected, a second
  process accepts the same cookie); `tests/e2e/session.spec.ts` (persistent cookie attributes);
  `tests/web/api-route.test.ts`
  for the `Origin` check (foreign, missing, look-alike origins); the isolation suite repeats it on
  every write route (foreign and missing `Origin` → 403).

## 10. Password hashing
- **What:** argon2id (`@node-rs/argon2`) configured as Better Auth's hash/verify (its default is
  scrypt). Min length 12, max 128. Check against breached passwords (HIBP k-anonymity) on sign-up
  and password change.
- **Where:** `packages/services/src/auth/passwords.ts` and `breached-passwords.ts` (HIBP fails open
  with a warning log when unreachable).
- **Verified by:** `tests/services/auth.integration.test.ts` (stored hash starts with `$argon2id$`,
  breached and too short/long passwords rejected); `tests/services/auth-passwords.test.ts`.

## 11. Rate limiting
- **What:** login, sign-up, password reset, resending the verification email and changing the password or
  the email of an account: 5 attempts / 15 min per IP and per email (per user for account changes). API: 300
  requests / min per session. Imports: 20 / hour per pool. Storage in Postgres (no Redis).
  Exceeding returns 429 with `Retry-After`.
- **Where:** `packages/services/src/rate-limit/` (fixed-window limiter, one atomic
  `INSERT … ON CONFLICT DO UPDATE … RETURNING count` on `nestvault_identity.rate_limits`; keys are
  stored as HMACs, never an IP or an email); wired into Better Auth hooks in
  `packages/services/src/auth/create-auth.ts` (`sign-in` counts failed attempts only: the hit is
  taken before and given back after a success; password reset counts every call; `change-password` and `change-email` count every call, per
  signed-in user and per IP); API routes call
  `limitApiRequests(session.id)` (`apps/web/src/server/api/rate-limit.ts`). Auth buckets fail closed
  when the database is down, the API/imports/invites buckets fail open and log. Expired windows are
  deleted lazily. A sign-up that a closed instance refuses from the config alone (`ALLOW_SIGNUP=false`
  and no invite token) answers 403 without touching the limiter: it costs no database work. With an
  invite token the invite is looked up, so those attempts are counted. The IP and the email buckets
  are consumed one after the other on purpose: a request from a blocked IP never uses up the email
  bucket of someone else.
  Verification emails also share one limit per address whatever asked for them (sign-up, sign-in
  with the right password, the resend button, sign-up of an unverified address): one a minute and ten
  an hour (`auth.verifymail.*`). Over it nothing is sent but the request answers as usual, so the limit
  reveals nothing; a person who lost the link gets a new one a minute after the last.
- **Client IP:** in production put the app behind a reverse proxy / CDN and set
  `TRUSTED_PROXY_HOPS` (1 for one proxy): the `x-forwarded-for` entry counted from the right is the
  client, and each machine gets its own 5 / 15 min limit, so one attacker never blocks other users.
  With `TRUSTED_PROXY_HOPS=0` (local development) the header is ignored (Next.js fills it from the
  socket only when the client did not send it, so it cannot be trusted) and the per-IP check uses a
  shared, loose bucket (50 / 15 min): 5 failures of one person never lock out others, and the
  per-email buckets still hold guessing on one account to 5. The web process logs a warning when it
  runs in production with `TRUSTED_PROXY_HOPS=0`.
- **Verified by:** `tests/services/rate-limit.integration.test.ts` (6th failed sign-in is 429 per
  IP and per email, a closed sign-up writes nothing but an invite-token attempt is counted, reset after the window, 40 parallel hits let exactly 5 through, spoofed
  `x-forwarded-for` ignored, injection payload as data, fail closed/open) and
  `tests/services/client-ip.test.ts`. Invites add two buckets: `invites` (20 a day per pool, fails
  open) and `invites.lookup` (60 a minute per client IP for the public invite page, fails open);
  `tests/services/invites.integration.test.ts` covers the 21st invite and the 61st lookup. Confirming
  a pool transfer with the password (NES-28) counts in the account's `auth.account.user` bucket, so
  a stolen session cannot guess the password faster than the other password checks allow;
  `tests/services/members.integration.test.ts` covers the sixth wrong password, for a transfer and for
  an owner promotion alike.

## 12. Bot protection
- **What (now):** sign-up is closed by default (`ALLOW_SIGNUP=false`); people join through invites
  (single-use token, 7 days, bound to the invited email). Rate limits (11) cover login.
- **What (when exposed to the internet):** Cloudflare Turnstile on sign-up, login and password
  reset.
- **Where:** `packages/services/src/auth/signup-policy.ts` (the invite check is a port, wired to the
  invites table by `createInviteVerifier`, NES-27; `x-invite-token` header).
- **Verified by:** `tests/services/auth.integration.test.ts` (403 when `ALLOW_SIGNUP=false` without
  a valid invite for that email), `tests/services/signup.integration.test.ts` (403 `signup_closed`)
  and `tests/e2e/signup.spec.ts` (both modes).

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
- **Verified by:** validation-failure test per route (400 with field errors); for every body route
  the isolation suite also covers unknown fields (control 8).

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
- **Statement uploads (NES-57)** — `POST /api/v1/pools/:poolId/imports` (multipart). The body is
  read only after the caller is a member with `imports.run` (the service calls `read()` after the
  guards), counted while it is read and cut off at 10 MB plus the multipart envelope (413, also
  when `Content-Length` lies); at most one `file` and a few short text fields (`accountId`,
  `parserId`, `spec`), anything else is a 400. The type is decided from the **bytes** by
  `imports/file-type.ts` (`%PDF-`; a zip with `[Content_Types].xml` and `xl/workbook`; text without
  NUL and almost no control characters) and the extension must agree with it (415), so an `.exe`
  renamed `.xlsx` never reaches the parser. The file name is cleaned (no path, no control
  characters, 200 characters) and kept only as metadata. The file is stored encrypted (5) before
  the preview exists; the preview rows live in `import_batches.preview` (RLS) and are dropped when
  the batch is committed or discarded. 20 uploads an hour per pool (`imports` bucket). Audit:
  `import.uploaded` / `import.committed` / `import.discarded` with the batch id and a row count.
  The commit writes through the repositories only, in one `withPool` transaction, with
  `ON CONFLICT DO NOTHING` on `(pool_id, account_id, hash)` (lines) and `(pool_id, account_id,
  ext_id)` (broker operations), never touches notes or categories chosen by hand, and answers 404
  for a batch of another pool, 409 for one already settled.
  `GET /api/v1/pools/:poolId/imports` (NES-64, the history of the import screen) runs the same guards
  (session, strict query, membership 404, `imports.run` 403, `withPool`) and answers file name,
  counts, format and date only, never rows or content; the page `/[poolId]/importar` loads nothing
  for a caller without `imports.run`. The screen renders everything the file says as text (React
  escapes it; checked in `tests/web/imports-screen.test.tsx`), and `accountHint` (the account number
  of the file) only goes to a caller who may import.
  Verified by `tests/services/imports.integration.test.ts` (guards, rate limit, format choice,
  preview writes nothing, idempotent commit, identical lines, notes kept, rollback, other pool,
  audit without content, broker commit), `tests/services/imports-file-type.test.ts`,
  `tests/services/imports-plan.test.ts`, `tests/services/imports-parser-client.test.ts`,
  `tests/db/import-batches.repo.integration.test.ts` and
  `tests/db/import-support.repo.integration.test.ts` (RLS, isolation, injection payloads),
  `tests/web/imports-route.integration.test.ts` (the multipart route: 401, 404, 403, 413, 415, 400,
  Origin) and the route registry of the isolation suite.
- **The prototype's JSON export (NES-47)** is the one upload that is data, not a statement, and it
  writes a whole pool at once, so it is the strictest. `POST /api/v1/pools/:poolId/import-prototype`:
  the body is counted while it is read and cut off at 10 MB (413), parsed as strict UTF-8 JSON, its
  nesting measured iteratively (more than 8 levels is a 400, so a hostile file cannot overflow the
  stack) and validated with a zod schema that is `.strict()` at every level and caps the size of
  every list; one unknown field is a 400 that names its path. Only the owner may run it
  (`pool.import`, 403 for the rest, 404 for non-members), at most 20 calls an hour per pool (`imports`
  bucket), and only into an empty pool (409). Everything runs in one `withPool` transaction: all or
  nothing, with an advisory lock so two simultaneous imports cannot both pass the emptiness check.
  Every value goes through the repositories' bound parameters (the text of a movement, a person or a
  category is data, never SQL); control characters are stripped from text before the insert; the
  prototype's 32-bit hashes are discarded and recomputed with SHA-256. The answer and the audit entry
  (`pool.prototype_imported`) carry counts and warning codes only, never content; comments a broker
  put on a movement are dropped, and notes are never read from or written by the import. The file is
  held in memory for the request and never stored.
  Verified by `tests/services/prototype-import.integration.test.ts` (dry run writes nothing, the
  fixture's counts and warnings, 409 on a non-empty pool and under two parallel commits, 400 for
  malformed or unknown fields with nothing written, owner only, other pool, rollback when a late
  write fails, injection payloads stored literally, month notes untouched, rate limit, plan-limit
  hook), `tests/services/prototype-import-map.test.ts` (schema and mapping),
  `tests/db/prototype-import.repo.integration.test.ts` (bulk inserts and counts: injection payload,
  isolation), `tests/web/prototype-import-route.test.ts` (401, Origin, 413, error mapping) and the
  route registry of the isolation suite.

## 17. Minimal API responses
- **What:** every response is built from an explicit zod output schema (DTO) — never return a DB
  row as-is. Never expose password/token hashes, internal flags or other pools' data. The same
  schemas feed OpenAPI.
- **Verified by:** the isolation suite parses every success body with the route's output schema
  with all objects closed (`strictly()` in `tests/support/strict-schema.ts`, so an extra field fails)
  and every error body with the one public error shape.

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
- **Mail:** `nodemailer` (`packages/services`) is the only SMTP client: no runtime dependencies of
  its own, no install script, and the de-facto Node library for SMTP (the alternative is writing the
  protocol by hand).
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
- **Verified by:** docker-compose review (no network/volumes for the parser container) and, since
  NES-56, `services/parser/tests/test_container.py` (marked `docker`, run by the `parser` CI job):
  the container cannot open outbound connections, runs as uid 10001 with a read-only root
  filesystem, and the rendered compose file has `read_only`, `cap_drop: [ALL]`, an `internal`
  network, no volumes, no published port and no database variable; `test_limits.py` (11 MB file,
  zip bomb, entry count, job timeout, regex timeout) and `test_auth.py` (401 without the shared
  secret; constant-time compare); tests that
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
