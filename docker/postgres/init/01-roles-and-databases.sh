#!/usr/bin/env bash
# Runs once, the first time the data volume is created (use `pnpm db:reset` to run it again).
# Passwords come from the container environment and are passed to psql as variables, so they
# are quoted by psql and never written to a file.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v identity_pw="$IDENTITY_RW_PASSWORD" \
  -v app_pw="$APP_RW_PASSWORD" \
  -v migrator_pw="$MIGRATOR_PASSWORD" <<'SQL'
-- Migration user: owns the databases and schemas, used only by migrations.
CREATE ROLE nestvault_migrator LOGIN PASSWORD :'migrator_pw'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- Runtime users. app_rw is not a superuser, not the table owner and cannot bypass RLS.
CREATE ROLE identity_rw LOGIN PASSWORD :'identity_pw'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE app_rw LOGIN PASSWORD :'app_pw'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

CREATE DATABASE nestvault_identity OWNER nestvault_migrator;
CREATE DATABASE nestvault_app OWNER nestvault_migrator;
CREATE DATABASE nestvault_identity_test OWNER nestvault_migrator;
CREATE DATABASE nestvault_app_test OWNER nestvault_migrator;

-- Nobody connects unless explicitly allowed.
REVOKE CONNECT ON DATABASE nestvault_identity FROM PUBLIC;
REVOKE CONNECT ON DATABASE nestvault_app FROM PUBLIC;
REVOKE CONNECT ON DATABASE nestvault_identity_test FROM PUBLIC;
REVOKE CONNECT ON DATABASE nestvault_app_test FROM PUBLIC;

-- The maintenance databases are open to PUBLIC by default; close them too. Superusers still connect.
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;

GRANT CONNECT ON DATABASE nestvault_identity, nestvault_identity_test TO identity_rw;
GRANT CONNECT ON DATABASE nestvault_app, nestvault_app_test TO app_rw;
SQL

# Per-database schema privileges: the runtime user may use tables the migrator creates.
grant_runtime_user() {
  local database="$1" runtime_user="$2"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$database" \
    -v runtime_user="$runtime_user" <<'SQL'
GRANT USAGE ON SCHEMA public TO :"runtime_user";
ALTER DEFAULT PRIVILEGES FOR ROLE nestvault_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"runtime_user";
ALTER DEFAULT PRIVILEGES FOR ROLE nestvault_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"runtime_user";
SQL
}

grant_runtime_user nestvault_identity identity_rw
grant_runtime_user nestvault_identity_test identity_rw
grant_runtime_user nestvault_app app_rw
grant_runtime_user nestvault_app_test app_rw
