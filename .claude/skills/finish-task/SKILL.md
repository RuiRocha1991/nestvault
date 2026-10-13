---
name: finish-task
description: Run NestVault's definition of done and open the pull request. Use it at the end of EVERY development task in this repo — when the user says "terminei", "está feito", "fecha a task", "abre o PR", "finish NES-12", "ready for review", or when you yourself are about to say a task is complete. It runs the security review for new routes, checks unit tests, API docs (OpenAPI + Postman), SQL injection, the 21 security controls, lint/typecheck/tests, then writes the PR with the task checklist and a full explanation.
---

# Finish a task

Nothing is "done" until every step below has run and its result is reported. The reason is
simple: this app holds a family's financial data, and each step catches a different class of
mistake that tests alone miss. Run the steps in order; fix what fails and re-run before moving on.

## 0. Collect the change set

- `git diff --stat <base>...HEAD` and `git status` — know every file that changed.
- From the diff, list: **new or changed routes** (pages under `app/`, Server Actions, Route
  Handlers under `app/api/`, worker job handlers), **new or changed services**, **new or changed
  repository functions / tables**, **new dependencies**.

## 1. Security review (new or changed routes)

If the list of routes is not empty, run the `/security-review` skill (Skill tool,
`security-review`). Then check each route explicitly against this list and fix anything missing:

- `requireSession()` → 401 without session
- zod input schema, `.strict()` (no mass assignment) → 400
- `requirePoolAccess` → 404 for non-members
- `can(ctx, '<permission>')` → 403
- `withPool(ctx, …)` for every `nestvault_app` query (RLS)
- audit log entry for writes
- `Origin` check for write Route Handlers (CSRF)
- rate limit where `docs/security.md` §11 requires it
- response built from an output schema (no raw rows)

If there are no route changes, say so explicitly ("no routes changed — security review skipped").

## 2. Unit tests for every service

For every new or changed function in `packages/services` and `packages/domain`, confirm Vitest
tests exist for: happy path, validation failure, permission denied (403), other pool (404).
Domain functions get tests with the reference values from the `nestvault-domain` skill when
relevant. Importers get a fixture-based test. Write missing tests now, then run `pnpm test`.

## 3. API documentation and Postman

For every Route Handler under `/api/v1`:
- it is registered in the OpenAPI registry with request and response schemas, security
  (session cookie), and error responses (400/401/403/404/429);
- run `pnpm openapi` and commit the updated `docs/api/openapi.json`.

When the task adds or changes endpoints, update `tests/api/nestvault.postman_collection.json`
(one request per endpoint, example body, tests asserting status codes) and
`tests/api/local.postman_environment.json` (variables: `baseUrl`, `poolId`; never real
credentials). Postman can also import `docs/api/openapi.json` directly.

## 4. SQL injection

Re-read every new or changed query:
- only the Drizzle builder or `sql\`…\`` with interpolated values (which become bound parameters);
- no string concatenation into SQL; no user input in `sql.raw` / `sql.identifier`;
- dynamic sort or filter columns go through an allow-list (`z.enum([...])`);
- each new repository function has a test with a payload such as `' OR 1=1 --` and
  `'; DROP TABLE accounts; --` proving it is stored or matched literally.

## 5. Security baseline

Walk the 21 controls in `docs/security.md`. For each one that this change touches, confirm its
"Verified by" item exists (test, CI step). Mark the ones that do not apply. Pay special attention
to: new env vars (1, 2 — add to `.env.example` with a placeholder, never `NEXT_PUBLIC_` for
secrets), new tables (4), uploads (16), logs (15), parser service or AI (21), new dependencies (20 — justify each).

## 6. Quality gates

Run `pnpm lint && pnpm typecheck && pnpm test` (and `pnpm test:e2e` when UI flows changed; `pytest` in `services/parser` when parsers changed). All
must pass. Paste the summary lines of the output into the report.

## 7. Commit, push, PR

- Commits: `<KEY>: <imperative summary>`. The first push is the task's first commit; every later
  change while the PR is open is a **new commit** (no amend, no squash, no force-push) so the user
  can compare them. Squash into one commit only after the user says the PR can be merged (see
  `CLAUDE.md` → "Git workflow").
- Push the branch. Follow `CLAUDE.md` → "Git workflow" for the target branch (while the project
  is in "direct to master" mode there is no PR; report the results in chat instead).
- Open the PR only if the user asked for it or the workflow requires one. Title
  `<KEY>: <summary>`. Body: fill `.github/pull_request_template.md` completely:
  - **Task checklist** — the acceptance criteria from `start-task`, ticked.
  - **What was done** — every change grouped by package, with the reasons and trade-offs.
  - **Definition of done** — the result of steps 1–6, including security review findings and how
    each was fixed.
  - **How to test** — commands and Postman requests.
- If Atlassian tools are available, add a comment to the Jira issue with the PR link and (if the
  user agrees) move it to "In Review".

## Report format (in chat)

```
## <KEY> — definition of done
1. Security review: <run / skipped (no routes)> — <findings and fixes>
2. Unit tests: <N new, all services covered | gaps>
3. API docs: <openapi updated, Postman updated | n/a>
4. SQL injection: <queries reviewed, N payload tests>
5. Security baseline: <controls touched and status>
6. Lint/typecheck/tests: <pass | fail with output>
7. PR: <link | not opened (reason)>
```
