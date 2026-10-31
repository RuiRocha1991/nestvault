#!/usr/bin/env bash
# Creates (or refreshes) the worker role. Runs after 01-roles-and-databases.sh on a fresh volume and
# can be run again on an existing one: `pnpm db:worker-role`. Idempotent. The password comes from the
# container environment and is passed to psql as a variable, so it is quoted and never written down.
#
# worker_rw is like app_rw (no superuser, no BYPASSRLS, never the table owner) and, in the app
# databases only, it also uses the job queues in schema `pgboss` (granted by the migrations).
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v worker_pw="$WORKER_RW_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE worker_rw LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'worker_rw') \gexec
ALTER ROLE worker_rw WITH LOGIN PASSWORD :'worker_pw';
GRANT CONNECT ON DATABASE nestvault_app, nestvault_app_test TO worker_rw;
-- pg-boss upgrades (run by the migrator) must be able to alter tables the worker created at run time.
GRANT worker_rw TO nestvault_migrator;
SQL

for database in nestvault_app nestvault_app_test; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$database" <<'SQL'
GRANT USAGE ON SCHEMA public TO worker_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO worker_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO worker_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE nestvault_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO worker_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE nestvault_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO worker_rw;
-- worker_pools is written only by the trigger on accounts (NES-68): the worker just reads it.
DO $$ BEGIN
  IF to_regclass('public.worker_pools') IS NOT NULL THEN
    REVOKE ALL ON public.worker_pools FROM worker_rw;
    GRANT SELECT ON public.worker_pools TO worker_rw;
  END IF;
END $$;
SQL
done
