# API requests (Postman / Insomnia)

- `nestvault.postman_collection.json`: example requests with test scripts that assert the status
  and the body. One folder per resource; every new `/api/v1` endpoint adds its requests here.
- `local.postman_environment.json`: `baseUrl` and `poolId` for local development. It contains **no
  secrets**: never put a password, token or cookie in these files.
- The complete, always up-to-date reference is the OpenAPI document `docs/api/openapi.json`
  (`pnpm openapi` regenerates it; CI fails when it is stale). In development the same document is
  browsable at http://localhost:4000/api/docs (Swagger UI, never served in production).

## Run it

1. `pnpm dev` (the app listens on port 4000; from a Mac use the SSH tunnel in the README).
2. Postman: **Import** both JSON files, pick the **NestVault local** environment, run the
   collection (or the **Health** request). All tests are green when the app is up.

## Signing in (once sign-in exists, NES-19)

The API uses the session **cookie**, not a token:

1. Sign in through the app in the browser, or send the sign-in request from Postman.
2. Postman keeps the cookie in its **cookie jar** for `localhost`; later requests send it
   automatically.
3. Write requests (`POST`/`PUT`/`PATCH`/`DELETE`) must carry an `Origin` header equal to the app
   origin (`http://localhost:4000`), otherwise they get `403`. A browser sends it by itself; the
   collection has a **pre-request script** that sets `Origin: {{baseUrl}}` on every request, so new
   endpoints work without extra steps. If you build requests outside this collection (or import
   `openapi.json`), add that header yourself.

## Import the OpenAPI document instead

Postman and Insomnia can generate a collection from `docs/api/openapi.json` (**Import** -> pick the
file). That gives every endpoint without writing requests by hand; keep using this collection for
the examples and their test scripts.
