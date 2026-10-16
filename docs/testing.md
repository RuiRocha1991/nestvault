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

## Pool isolation and authorization suite (NES-30)

Every protected route is tested for the same things, and the cases are generated: a new route only
adds an entry to the registry.

| File | What it does |
| ---- | ------------ |
| `tests/support/route-registry.ts` | one entry per Route Handler under `app/api/v1`: method, path, `permission`, a valid `body`/`params`, the success `schema`, `foreign` (the same kind of resource in another pool) and the exemptions |
| `tests/support/api-world.ts` | the real services on the `_test` databases (same wiring as `createAuthRuntime`, a memory mailbox, a test clock) and `newScenario()`: pool A with an owner, an admin, a member and a viewer; pool B with its own owner and member; a newcomer with no pool |
| `tests/web/route-isolation.integration.test.ts` | generates the cases below for every entry and calls the real Route Handler with a real session cookie |
| `tests/web/route-registry.test.ts` | unit test: fails when a Route Handler on disk has no entry (or an entry has no handler) |
| `tests/support/expect-isolated.ts` | `expectIsolated({ database, seed, run, snapshot })`: seeds pool B, runs a repository function as pool A and demands an empty result and an unchanged B (`tests/db/expect-isolated.integration.test.ts` shows it on the probe repository and proves it fails on a leaking function) |
| `tests/support/strict-schema.ts` | `strictly(schema)` closes every object of a DTO, so a leaked field fails the parse |

Cases generated for a route under `/pools/:poolId` (scope `pool`):

1. no session → 401;
2. a non-member → 404, with a body identical to an unknown pool, a malformed pool id and somebody
   else's pool (timing is not asserted);
3. every role below `permission` → 403, and the lowest role that holds it is the one that succeeds
   (so a wrong `permission` in the registry fails the test);
4. an id of another pool in the URL or body → 404 and the resource unchanged (`foreign`);
5. extra fields (`poolId`, `id`, `role`, `createdBy`, `userId`, `ownerId`, `email`) → 400
   `validation_error`, for routes that read a body;
6. a foreign or missing `Origin` on writes → 403;
7. `leaks`: strings of pool B (ids, emails) must not appear in the response;
8. route-specific `negatives`, then the success: status, `Cache-Control: no-store`, the body parsed
   by the DTO with every object closed, and the entry's `check` of the resulting state.

Routes of the signed-in user (scope `user`: `/me`, `/me/sessions`, `POST /pools`, accepting an
invite) get 1, 4 (an id of another user), 5, 6, 7 and 8. Routes with no pool data (`/auth/*`,
`/health`) are `exempt` and must say why.

Adding a route (the `protected-route` skill does this step):

1. Copy the entry of a similar route in `tests/support/route-registry.ts`; set `permission` to what
   the service checks with `can()`, give a valid `body` and/or `params`, the success `schema`, and
   `foreign` (or `noForeignBecause` when the request names no resource).
2. Run `pnpm test:unit` (the static check) and `pnpm test:integration` (the generated cases).
3. A new repository function of the `app` database also gets one `expectIsolated` call.

The unit check reads the files, so it is the one that fails in CI when a route is added without an
entry. It finds `export const GET`, `export async function GET` and `export { handle as GET }`; it
cannot follow `export * from` or `export { X } from`, so a `route.ts` that uses either one fails the
check until its handlers are declared in the file itself. Prove the suite still bites after changing guards: remove a `can()` call or a pool filter and
the matching cases must fail.

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

## Auth test helpers (`tests/support/auth-harness.ts`)

Integration tests of Better Auth share one set of helpers instead of copying them: `postAuth(auth,
path, body, headers?)` (JSON + same Origin), `cookieOf(response)`, `registerUser(auth, identity,
email, { verified })` (sign-up that checks the answer and confirms the address, because sign-in needs
a verified email), `verifyEmail(identity, email)` (one account, through `usersRepo`),
`waitForMail(mail, count?)`, `tokenIn(text, page)` (token of the emailed link) and `rows(identity,
query)`. `APP_URL`, `PASSWORD` and `SECRET` are exported too.

## Browser tests

- `playwright.config.ts` builds the web app and starts it with `next start` on port **4010**
  (4000 stays free for `pnpm dev`). Chromium comes from `pnpm exec playwright install chromium`,
  or from `/opt/pw-browsers` when that folder exists. A second server on port **4011** (same build,
  same `_test` databases) runs with `ALLOW_SIGNUP=true` for the sign-up tests; the first keeps
  sign-up closed. The servers are one list in `playwright.config.ts`. The second one is only started
  when the run can need it: a full run, or one that names `signup` (`pnpm test:e2e login` starts just
  the first); `E2E_SIGNUP_SERVER=1|0` forces it on or off. Each has its own `APP_URL`, because the Origin check compares against it.
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
- `session.spec.ts`: refresh keeps the page with no request to `/login`, a new tab and a new
  context with the stored cookies (browser restart) are signed in, the cookie is persistent
  (30 days, HttpOnly, SameSite=Lax), and a revoked session goes to `/login?…&reason=expired` with
  the expiry toast; signing out in one tab sends the other tab to the login screen at once, and a
  tab whose session was ended without telling it leaves the app when it gets focus. The server-restart, sliding-renewal, expiry and `Secure` cases are integration
  tests in `tests/services/auth.integration.test.ts`.

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
- **JUnit XML**: both test jobs write `reports/junit-vitest.xml` / `reports/junit-e2e.xml`, upload them
  as the `junit-vitest` / `junit-e2e` artifacts and publish a per-test check on the pull request
  (`Test results (Vitest)` / `Test results (Playwright)`, via `mikepenz/action-junit-report`).
- **Reports on the Jira issue**: when the branch is named after a Jira key (`NES-12`), each test job
  also attaches its JUnit file to that issue (`scripts/ci/attach-junit-to-jira.sh`, one file per run
  and commit). It needs the repository secrets `JIRA_BASE_URL` (`https://<site>.atlassian.net`),
  `JIRA_USER_EMAIL` and `JIRA_API_TOKEN`; without them, or on pull requests from forks, the step is
  skipped and the build is unaffected. The token is only read from the environment and never printed.
