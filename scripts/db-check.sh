#!/usr/bin/env bash
# Verifies the database isolation guarantees of the local Docker stack (NES-12 acceptance criteria).
# Reads .env.local through the shell only to authenticate; it never prints a password.
set -uo pipefail
cd "$(dirname "$0")/.."
set -a
# shellcheck disable=SC1091
. ./.env.local
set +a

failures=0
pass() { echo "  ok    $1"; }
fail() { echo "  FAIL  $1"; failures=$((failures + 1)); }

# Runs psql inside the container over TCP (password authentication, like a real client).
sql() { # user password database query
  docker compose exec -T -e PGPASSWORD="$2" postgres \
    psql -h 127.0.0.1 -U "$1" -d "$3" -tAc "$4" 2>/dev/null
}

echo "Service health"
[ "$(docker compose ps --format '{{.Health}}' postgres)" = "healthy" ] && pass "postgres healthcheck is green" || fail "postgres is not healthy"
curl -fsS -o /dev/null http://127.0.0.1:8025 && pass "mailpit UI answers on 127.0.0.1:8025" || fail "mailpit UI not reachable"

echo "Database isolation"
sql identity_rw "$IDENTITY_RW_PASSWORD" nestvault_identity "select 1" >/dev/null && pass "identity_rw connects to nestvault_identity" || fail "identity_rw cannot connect to nestvault_identity"
sql app_rw "$APP_RW_PASSWORD" nestvault_app "select 1" >/dev/null && pass "app_rw connects to nestvault_app" || fail "app_rw cannot connect to nestvault_app"
sql app_rw "$APP_RW_PASSWORD" nestvault_identity "select 1" >/dev/null && fail "app_rw CAN connect to nestvault_identity" || pass "app_rw cannot connect to nestvault_identity"
sql identity_rw "$IDENTITY_RW_PASSWORD" nestvault_app "select 1" >/dev/null && fail "identity_rw CAN connect to nestvault_app" || pass "identity_rw cannot connect to nestvault_app"
sql app_rw "$APP_RW_PASSWORD" nestvault_app_test "select 1" >/dev/null && pass "app_rw connects to nestvault_app_test" || fail "app_rw cannot connect to nestvault_app_test"
sql app_rw "$APP_RW_PASSWORD" postgres "select 1" >/dev/null && fail "app_rw CAN connect to the postgres database" || pass "app_rw cannot connect to the postgres database"

echo "Role attributes"
attrs="$(sql postgres "$POSTGRES_PASSWORD" postgres "select rolsuper, rolbypassrls from pg_roles where rolname = 'app_rw'")"
[ "$attrs" = "f|f" ] && pass "app_rw: rolsuper = false, rolbypassrls = false" || fail "app_rw attributes are '$attrs'"
attrs="$(sql postgres "$POSTGRES_PASSWORD" postgres "select count(*) from pg_roles where rolname in ('app_rw','identity_rw','nestvault_migrator') and (rolsuper or rolbypassrls or rolcreatedb or rolcreaterole)")"
[ "$attrs" = "0" ] && pass "no application role is superuser, bypasses RLS or can create roles/databases" || fail "an application role has elevated attributes"

echo "Migrator and runtime privileges"
sql nestvault_migrator "$MIGRATOR_PASSWORD" nestvault_app_test "create table _check_probe (id int); select 1" >/dev/null \
  && pass "nestvault_migrator can create tables" || fail "nestvault_migrator cannot create tables"
sql app_rw "$APP_RW_PASSWORD" nestvault_app_test "insert into _check_probe values (1); select count(*) from _check_probe" | grep -qx 1 \
  && pass "app_rw can read and write tables created by the migrator" || fail "app_rw cannot use migrator tables"
sql app_rw "$APP_RW_PASSWORD" nestvault_app_test "drop table _check_probe" >/dev/null \
  && fail "app_rw can drop tables (it must not own them)" || pass "app_rw cannot drop tables"
sql nestvault_migrator "$MIGRATOR_PASSWORD" nestvault_app_test "drop table _check_probe" >/dev/null || true

echo "Network exposure"
port="${POSTGRES_PORT:-5433}"
bound="$(docker compose port postgres 5432)"
[ "$bound" = "127.0.0.1:$port" ] && pass "postgres is published on $bound only" || fail "postgres is published on '$bound'"
lan_ip="$(hostname -I | tr ' ' '\n' | grep -E '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' | head -n 1)"
if [ -n "$lan_ip" ]; then
  if (exec 3<>"/dev/tcp/$lan_ip/$port") 2>/dev/null; then
    fail "port $port answers on the LAN address $lan_ip"
  else
    pass "port $port is closed on the LAN address (checked from this machine)"
  fi
else
  echo "  skip  no private LAN address found on this machine"
fi

echo
if [ "$failures" -eq 0 ]; then echo "All checks passed."; else echo "$failures check(s) failed."; exit 1; fi
