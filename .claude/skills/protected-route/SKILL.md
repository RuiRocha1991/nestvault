---
name: protected-route
description: Template and checklist for adding or changing any NestVault endpoint — REST Route Handler under /api/v1, Server Action, or a page that loads pool data. Use it whenever you create or edit a route, action, API endpoint, CRUD for a resource (accounts, portfolios, transactions, goals, members, invites…), or expose a service to the UI, even if the user only says "add an endpoint" or "cria o CRUD de X". Produces the service with all guards, the zod schemas, the route, OpenAPI registration, Postman requests and the tests.
---

# Protected route

Every way into pool data goes through the same five guards, in the service layer, so that pages,
Server Actions, REST routes and the worker are equally protected. The route itself stays thin:
parse the request, call the service, map the result. If you find yourself putting a check in the
route instead of the service, move it — a second caller (Server Action, worker) would skip it.

## Files for a new resource `<res>` (e.g. `accounts`)

```
packages/services/src/<res>/schemas.ts      zod input + output schemas (shared with OpenAPI)
packages/services/src/<res>/<res>.service.ts use cases with guards
packages/services/src/<res>/<res>.service.test.ts
packages/db/src/app/repositories/<res>.repo.ts  (via db-migration skill if a table is new)
apps/web/app/api/v1/pools/[poolId]/<res>/route.ts          GET list, POST create
apps/web/app/api/v1/pools/[poolId]/<res>/[id]/route.ts     GET, PATCH, DELETE
apps/web/src/openapi/<res>.ts                registry entries
tests/api/nestvault.postman_collection.json  new folder "<res>"
```

## Schemas (`schemas.ts`)

```ts
import { z } from 'zod';
import { Money, IsoDate, Uuid } from '../shared/schemas';

// Only client-editable fields. .strict() rejects poolId, id, createdBy, role… (mass assignment).
export const CreateAccountInput = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(['checking', 'savings', 'term_deposit', 'brokerage']),
  currency: z.enum(['EUR', 'USD', 'GBP', 'CHF']),
  openingBalance: Money,          // decimal as string, e.g. "1234.56"
  openingDate: IsoDate,
}).strict();

export const UpdateAccountInput = CreateAccountInput.partial().strict();

// Output DTO: the only fields the client ever sees.
export const AccountDto = z.object({
  id: Uuid, name: z.string(), type: z.string(), currency: z.string(),
  openingBalance: Money, openingDate: IsoDate,
});
```

Sorting/filtering by a column name? Use `z.enum([...allowed columns])` — never pass a free string
to `orderBy`.

## Service (`<res>.service.ts`)

```ts
export async function createAccount(session: Session, poolId: string, input: unknown) {
  const data = CreateAccountInput.parse(input);                // 400 on failure
  const ctx = await requirePoolAccess(session, poolId);        // 404 if not a member
  await can(ctx, 'accounts.write');                            // 403
  const row = await withPool(ctx, async (tx) => {
    const created = await accountsRepo.insert(tx, ctx, data);  // repo sets pool_id from ctx
    await audit(tx, ctx, 'accounts.create', { id: created.id });
    return created;
  });
  return AccountDto.parse(toDto(row));                         // never return the raw row
}
```

`session` comes from `requireSession()` in the caller (route or action); services take it as a
parameter so they are unit-testable. Errors are typed (`ValidationError`, `NotFoundError`,
`ForbiddenError`, `RateLimitError`) and mapped once to HTTP by a shared handler.

## Route Handler

```ts
export const POST = route(async (req, { params }) => {
  assertSameOrigin(req);                       // CSRF for writes
  const session = await requireSession(req);   // 401
  await limitApiRequests(session.id);          // 429 + Retry-After (apps/web/src/server/api/rate-limit.ts)
  const { poolId } = PoolParams.parse(await params);
  const body = await readJson(req, { maxBytes: 64 * 1024 });
  const dto = await createAccount(session, poolId, body);
  return json(dto, 201);
});
```

`route()` wraps the handler: request id, error mapping to `{ error: { code, message } }`
(no stack traces, no SQL), and redacted logging.

## Server Action

Same service, different entry: `'use server'`, `const session = await requireSession()`, call the
service, `revalidatePath`. Next.js already checks the Origin for Server Actions.

## OpenAPI registration

```ts
registry.registerPath({
  method: 'post', path: '/api/v1/pools/{poolId}/accounts', tags: ['Accounts'],
  security: [{ sessionCookie: [] }],
  request: { params: PoolParams, body: { content: { 'application/json': { schema: CreateAccountInput } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: AccountDto } } },
    400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 429: errorResponse,
  },
});
```

Run `pnpm openapi` afterwards.

## Postman

Add a folder for the resource with one request per endpoint; use `{{baseUrl}}` and `{{poolId}}`;
include a test script asserting the status code and that the response has no unexpected fields.

## Tests (required for every route)

Register the route in the isolation suite first (`tests/support/route-registry.ts`, described in
`docs/testing.md`, section "Pool isolation and authorization suite"): `tests/web/route-registry.test.ts`
fails CI for a Route Handler without an entry, and `tests/web/route-isolation.integration.test.ts`
then generates the cases of the table below for it. Add `expectIsolated()` for every new repository
function. The table is what the generated cases cover; write by hand only what is specific to the
route (service rules, injection payloads in string fields, the happy path in the service tests).

| Case | Expected |
| --- | --- |
| No session | 401 |
| Invalid body / extra field (`poolId`, `role`) | 400, nothing written |
| Not a member of the pool | 404 |
| Member without permission (viewer writing) | 403 |
| Happy path | 2xx, body matches output schema strictly |
| Row of another pool by id | 404, not changed |
| Injection payload in string fields | stored literally |
| Write without matching `Origin` | 403 |

Then run the `finish-task` skill.
