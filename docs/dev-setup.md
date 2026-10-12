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
```

`pnpm env:init` refuses to overwrite an existing `.env.local`. To start over, delete it and run
`pnpm db:reset` (this also deletes all local database data).

## 3. What runs

| Service  | Address                 | Purpose                                              |
| -------- | ----------------------- | ---------------------------------------------------- |
| Postgres | `127.0.0.1:5433`        | Two databases in one container (see below)           |
| Mailpit  | SMTP `127.0.0.1:1025`   | Catches every email the app sends                    |
| Mailpit  | UI `http://localhost:8025` | Read the emails (verification, reset, invites)    |

### Databases and users

| Database                  | Runtime user  | Notes                                     |
| ------------------------- | ------------- | ----------------------------------------- |
| `nestvault_identity`      | `identity_rw` | Users, sessions, pools, members, invites  |
| `nestvault_app`           | `app_rw`      | Financial data; every table has RLS       |
| `nestvault_identity_test` | `identity_rw` | Integration tests                         |
| `nestvault_app_test`      | `app_rw`      | Integration tests                         |

- `identity_rw` can only connect to the identity databases, `app_rw` only to the app databases.
  `CONNECT` is revoked from `PUBLIC` on all of them, including `postgres` and `template1`.
- `app_rw` is not a superuser, does not bypass RLS (`NOBYPASSRLS`) and does not own the tables,
  so row-level security applies to it.
- `nestvault_migrator` owns the databases and creates tables; only migrations use it.
- The roles are created once, by `docker/postgres/init/01-roles-and-databases.sh`, the first time
  the data volume is created. Passwords come from `.env.local`.

## 4. Commands

| Command                                  | What it does                                                    |
| ---------------------------------------- | --------------------------------------------------------------- |
| `pnpm env:init`                          | Create `.env.local` from `.env.example` with random secrets     |
| `pnpm db:up` / `pnpm db:down`            | Start / stop the containers (data is kept in a Docker volume)   |
| `pnpm db:reset`                          | Delete the volume after confirmation and recreate everything    |
| `pnpm db:check`                          | Verify isolation, role attributes and network exposure          |
| `pnpm db:psql:identity` / `db:psql:app`  | Open `psql` as the runtime user of that database                |

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

## Troubleshooting

- `variable is not set` from Compose: `.env.local` is missing; run `pnpm env:init`.
- Port already in use: stop the other service on 5433 / 1025 / 8025 (or change `POSTGRES_PORT`), or the previous stack with
  `pnpm db:down`.
- Changed the init script or the passwords: the script only runs on an empty volume; run
  `pnpm db:reset`.
