## Task

Jira: `<KEY>` — <one-line summary>

## Task checklist

What this task is expected to do (acceptance criteria). Tick each item when done.

- [ ] ...
- [ ] ...

## What was done

Explain every change, grouped by package or area, including design decisions and trade-offs.

### <package / area>
- ...

## Definition of done

- [ ] `/security-review` run for new or changed routes — findings fixed or explained below
- [ ] Unit tests for every new or changed service (`pnpm test` green)
- [ ] OpenAPI updated (`pnpm openapi`) and Postman collection in `tests/api/` updated when relevant
- [ ] SQL injection check done (query builder / bound parameters only, injection-payload tests)
- [ ] Security baseline (`docs/security.md`) — controls touched by this change are verified
- [ ] `pnpm lint && pnpm typecheck` pass

Security review notes:

## How to test

1. ...
