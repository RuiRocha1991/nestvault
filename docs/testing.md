# Testing

Tests block the merge: CI runs everything below on every pull request.

## Layers

| Layer           | Where                                   | Needs                              | Command                 |
| --------------- | --------------------------------------- | ---------------------------------- | ----------------------- |
| Unit            | `tests/<package>/*.test.ts(x)`          | nothing running                    | `pnpm test:unit`        |
| Integration     | `tests/**/*.integration.test.ts`        | Docker Postgres (`pnpm db:up`)     | `pnpm test:integration` |
| Browser (e2e)   | `tests/e2e/*.spec.ts` (Playwright)      | Chromium, a production build       | `pnpm test:e2e`         |
| Everything      |                                         |                                    | `pnpm test`             |
| With coverage   |                                         |                                    | `pnpm test:coverage`    |

Vitest has one **unit project per package** (`web`, `worker`, `domain`, `services`, `db`, `ui`,
`config`, `lint`, so `pnpm test --project services` works) and one `integration` project. The
rule that decides where a test goes is the file name: `*.integration.test.ts` is integration.

## Integration tests

- Run on the `nestvault_identity_test` and `nestvault_app_test` databases, with the **same roles
  as the app** (`app_rw` without `BYPASSRLS`, so RLS applies). `tests/db/global-setup.ts` drops the
  tables, applies the real migrations and adds the test-only probe table, once per run.
- `tests/db/harness.ts`: `openTestDatabase()`, `withPool`, `asMigrator`, `truncateAll`,
  `createTwoPools()`, `pgErrorCode()`. Truncate between tests, not between files.
- If Postgres is down the run stops with `Start them with: pnpm db:up` (it never skips silently).
- `tests/web/headers.integration.test.ts` builds the web app and serves it on port 4010 to read
  the real response headers.

## Factories (`tests/support/factories.ts`)

In-memory objects, usable from unit tests with mocked repositories:

| Helper                                    | Gives                                                              |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `createUser(overrides?)`                  | a user with a unique UUID v7 and `@example.test` address           |
| `createPool(owner?)`                      | `{ poolId, owner }`                                                |
| `asMember(pool, role, { user, permissions })` | the `PoolContext` of that user in that pool                    |
| `asSystem(pool)`                          | the `PoolContext` of background work                               |

`createUser` and `signIn()` that really persist a user and return session cookies arrive with
Better Auth (NES-19), which owns the identity tables. The permission sets per role arrive with
NES-25; until then pass the permission names explicitly.

## Browser tests

- `playwright.config.ts` builds the web app and starts it with `next start` on port **4010**
  (4000 stays free for `pnpm dev`). Chromium comes from `pnpm exec playwright install chromium`,
  or from `/opt/pw-browsers` when that folder exists.
- `smoke.spec.ts`: the shell loads, navigation works, the theme survives a reload.
  `csp.spec.ts`: no Content-Security-Policy violation on the shell pages.
- Failures keep a trace and an HTML report (CI uploads them as the `playwright-report` artifact).
- Sign-in: `tests/e2e/global-setup.ts` resets the `_test` databases (needs `pnpm db:up`), creates
  the E2E owner (`tests/e2e/support/user.ts`) and stores a signed-in session in
  `tests/e2e/.auth/owner.json` (git-ignored). Specs that only need "a signed-in user" declare
  `test.use({ storageState: STORAGE_STATE })`; `login.spec.ts` starts signed out. The web server
  of the run uses the `_test` databases and `APP_URL=http://127.0.0.1:4010`.
- `login.spec.ts`: sign in → app → sign out, revoked cookie, `next` handling (open-redirect
  payloads), identical message for wrong password and unknown email, rate-limit countdown (429
  mocked until NES-23), mobile and light layouts.

## Coverage

`pnpm test:coverage` (CI) writes `coverage/` (`lcov`, `coverage-summary.json`) and fails when line
coverage is below **90 %** for `packages/domain` or **80 %** for `packages/services`
(`vitest.config.ts`). Source files that no test imports are counted too (checked with a temporary untested file in `packages/domain`: the domain figure dropped to 50 % and the gate failed). The CI run uploads the report as the `coverage` artifact and prints the
totals in the job summary. React pages and components are covered by Playwright, not by v8.

## CI (`.github/workflows/security.yml`)

- **Audit, lint, typecheck, test**: audit, secrets in `NEXT_PUBLIC_`, Docker Postgres + Mailpit
  (the same `docker-compose.yml` as local development: two databases, three roles), migrations,
  lint, typecheck, `pnpm openapi --check`, `pnpm test:coverage`.
- **Browser checks (Playwright)**: separate job, Chromium cached by Playwright version.
- **Secret scan (gitleaks)**.
