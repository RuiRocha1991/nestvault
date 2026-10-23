# Development setup

NestVault is developed on an Ubuntu machine with Docker and used from a Mac through an SSH tunnel.
Nothing is exposed to the network: Postgres and Mailpit are bound to `127.0.0.1` on the Ubuntu
machine (security control 3).

## 1. Install the tools (Ubuntu)

1. **Docker** with the Compose plugin: <https://docs.docker.com/engine/install/ubuntu/>. Add your
   user to the `docker` group (`sudo usermod -aG docker $USER`, then log in again) so `docker`
   works without `sudo`.
2. **Node 22** through nvm: <https://github.com/nvm-sh/nvm>, then `nvm install` in the repository
   (it reads `.nvmrc`).
3. **pnpm 12**: `npm i -g pnpm@12`.
4. `openssl` (preinstalled on Ubuntu) is used to generate secrets.

## 2. First run

```bash
git clone git@github.com:RuiRocha1991/nestvault.git && cd nestvault
pnpm install --frozen-lockfile
pnpm env:init      # creates .env.local with random passwords and secrets (never committed)
pnpm db:up         # starts Postgres 16 and Mailpit, waits until they are healthy
pnpm db:check      # verifies isolation between the databases (see below)
pnpm db:migrate    # applies the migrations to nestvault_identity and nestvault_app
```

`pnpm env:init` refuses to overwrite an existing `.env.local`. To start over, delete it and run
`pnpm db:reset` (this also deletes all local database data).

### Keeping `.env.local` up to date

`.env.example` starts with `# env-version: N`; `pnpm env:init` copies it into `.env.local`.
After pulling changes that touch `.env.example`:

```bash
pnpm env:check   # compares the versions and lists the variable NAMES your .env.local lacks
pnpm env:sync    # adds the missing ones (random values where needed); existing values are untouched
```

`env:check` never prints values. A `.env.local` created before versions existed shows "version none";
it works the same, the check goes by variable names.

**Environment versions** (bump `env-version` in `.env.example` and add a line here whenever a
variable is added, renamed or removed):

| Version | Task   | Change                                                              |
| ------- | ------ | ------------------------------------------------------------------- |
| 1       | NES-12 | Postgres, database URLs, test databases, app secrets, SMTP          |
| 2       | NES-16 | `ENABLE_API_DOCS` (Swagger UI at `/api/docs`, development only)    |
| 3       | NES-23 | `TRUSTED_PROXY_HOPS` (proxies trusted for `x-forwarded-for`, 0 = none) |
| 4       | NES-56 | `PARSER_URL`, `PARSER_SECRET` (internal statement parser service)    |
| 5       | NES-57 | `IMPORT_STORAGE_DIR` (encrypted uploads); `APP_ENCRYPTION_KEY` may be a list `new:<key>,old:<key>` to rotate |
| 6       | NES-65 | `WORKER_RW_PASSWORD`, `DATABASE_URL_WORKER`, `TEST_DATABASE_URL_WORKER` (worker role). On an existing volume run `pnpm db:worker-role` |

## 3. What runs

| Service  | Address                 | Purpose                                              |
| -------- | ----------------------- | ---------------------------------------------------- |
| Postgres | `127.0.0.1:5433`        | Two databases in one container (see below)           |
| Mailpit  | SMTP `127.0.0.1:1025`   | Catches every email the app sends                    |
| Mailpit  | UI `http://localhost:8025` | Read the emails (verification, reset, invites)    |
| Parser   | `http://127.0.0.1:8100` | Statement parser (Python), reached through a local forwarder; the container itself has no network out. Needs `X-Parser-Secret` |

### Databases and users

| Database                  | Runtime user  | Notes                                     |
| ------------------------- | ------------- | ----------------------------------------- |
| `nestvault_identity`      | `identity_rw` | Users, sessions, pools, members, invites  |
| `nestvault_app`           | `app_rw`      | Financial data; every table has RLS       |
| `nestvault_app`           | `worker_rw`   | Same tables for the worker, plus the job queues in schema `pgboss` |
| `nestvault_identity_test` | `identity_rw` | Integration tests                         |
| `nestvault_app_test`      | `app_rw`      | Integration tests                         |

- `identity_rw` can only connect to the identity databases, `app_rw` only to the app databases.
  `CONNECT` is revoked from `PUBLIC` on all of them, including `postgres` and `template1`.
- `app_rw` is not a superuser, does not bypass RLS (`NOBYPASSRLS`) and does not own the tables,
  so row-level security applies to it.
- `worker_rw` (the worker process only) is like `app_rw`: no superuser, no `BYPASSRLS`, not an owner, and
  `CONNECT` only to the app databases. The migrations install the job queues (schema `pgboss`, owned by
  `nestvault_migrator`) and give it `USAGE`/`CREATE` there, because pg-boss makes one table per queue at
  run time. On a volume created before NES-65 run
  `pnpm env:sync && pnpm db:worker-role && pnpm db:migrate`.
- `nestvault_migrator` owns the databases and creates tables; only migrations use it.
- The roles are created once, by `docker/postgres/init/01-roles-and-databases.sh`, the first time
  the data volume is created. Passwords come from `.env.local`.

## 4. Commands

| Command                                  | What it does                                                    |
| ---------------------------------------- | --------------------------------------------------------------- |
| `pnpm env:init`                          | Create `.env.local` from `.env.example` with random secrets     |
| `pnpm env:check` / `pnpm env:sync`       | List / add the variables your `.env.local` lacks (names only)   |
| `pnpm db:up` / `pnpm db:down`            | Start / stop the containers (data is kept in a Docker volume)   |
| `pnpm db:reset`                          | Delete the volume after confirmation and recreate everything    |
| `pnpm db:check`                          | Verify isolation, role attributes and network exposure          |
| `pnpm db:psql:identity` / `db:psql:app`  | Open `psql` as the runtime user of that database                |
| `pnpm db:worker-role`                    | Create or refresh `worker_rw` on an existing volume             |
| `pnpm dev:worker` / `pnpm worker:runs`   | Start the job worker / list the last runs and failures          |

`pnpm db:check` fails if: a runtime user can connect to the other database or to `postgres`;
`app_rw` is a superuser or can bypass RLS; `app_rw` can drop tables; Postgres is published on
anything other than `127.0.0.1`; or the Postgres port answers on the machine's LAN address.

## 5. Open the app from the Mac

Forward the ports through SSH so the browser on the Mac uses `http://localhost:4000`:

```bash
ssh -L 4000:localhost:4000 -L 8025:localhost:8025 -L 5433:localhost:5433 user@ubuntu-host
```

Then open `http://localhost:4000` (the app) and `http://localhost:8025` (Mailpit). A database tool on
the Mac connects to `localhost:5433` (the `-L 5433` part; leave it out if you do not need it). The
port is 5433 on both machines on purpose: a Postgres already running on the Mac (5432) does not
clash with the tunnel. To use another port, set `POSTGRES_PORT` in `.env.local`, run `pnpm db:up`
again and use the same number in `-L`.

Alternative: VS Code Remote-SSH, which forwards the ports for you.

**Why not expose port 4000 on the LAN?** The dev server has no TLS and the session cookie is not
`Secure` on localhost. Through the tunnel the browser sees `localhost`, so cookies behave exactly
like local development, and nothing on your network can reach the app or the database.

### Staying signed in

Sessions live in the database (not in server memory), and the cookie is persistent (30 days,
renewed after a day of activity), so a refresh, a new tab, a browser restart and a server restart
all keep you signed in while the session is valid. A session that was ended elsewhere or expired
sends you to `/login?next=…` with the message "A tua sessão expirou". A tab left open notices it
by itself: at once when another tab of the same browser signs out, and otherwise when the tab is
shown again or within a minute (the app checks `/api/v1/auth/get-session`). A second browser has its
own session, so signing out in one does not end the other.

Two things make a browser drop the session, and both are about how you open the app:

- **Open it as `http://localhost:4000` through the tunnel, never by the machine's LAN IP.** The
  `Secure` flag follows `APP_URL`: with `APP_URL=http://localhost:4000` the cookie is not `Secure`
  and works over plain HTTP; with an `https` `APP_URL` a browser refuses to keep it over HTTP.
- **`APP_URL` must be the address in the address bar.** Writes are accepted only when `Origin`
  matches it (CSRF), so another host (the LAN IP, `127.0.0.1` instead of `localhost`) fails to sign in.

Manual check (Safari and Chrome on the Mac, through the tunnel; done by hand because it needs real
browsers): sign in → open `/<pool>/despesas` → press ⌘R → open the same page in a new tab → quit
and reopen the browser → restart `pnpm dev` and refresh. In every step you must still be signed in
on the same page, with no login screen showing.

## Troubleshooting

- `variable is not set` from Compose: `.env.local` is missing; run `pnpm env:init`.
- Port already in use: stop the other service on 5433 / 1025 / 8025 (or change `POSTGRES_PORT`), or the previous stack with
  `pnpm db:down`.
- Changed the init script or the passwords: the script only runs on an empty volume; run
  `pnpm db:reset`.
