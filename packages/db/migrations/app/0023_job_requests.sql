CREATE TABLE "job_requests" (
	"pool_id" uuid NOT NULL,
	"job_name" text NOT NULL,
	"token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_requests_pool_id_job_name_pk" PRIMARY KEY("pool_id","job_name"),
	CONSTRAINT "job_requests_job_known" CHECK ("job_requests"."job_name" in ('deposits.link'))
);
--> statement-breakpoint
-- job_requests is global (no RLS): requests for a worker job about one pool (NES-147). app_rw has no
-- privilege on it and writes only through request_pool_job(), which takes the pool from app.pool_id;
-- worker_rw reads the rows and deletes the ones it turned into queue runs. The roles may not exist yet
-- (fresh clone before the init scripts, CI), so every grant is guarded by pg_roles. When a role is created
-- after this migration, docker/postgres/init/02-worker-role.sh repeats the whole block (the app_rw revoke
-- and EXECUTE grant, the worker_rw SELECT/DELETE grant), also guarded by to_regclass/to_regprocedure.
DO $grants$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    REVOKE ALL ON "job_requests" FROM app_rw;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'worker_rw') THEN
    REVOKE ALL ON "job_requests" FROM worker_rw;
    GRANT SELECT, DELETE ON "job_requests" TO worker_rw;
  END IF;
END $grants$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION request_pool_job(job text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  pool uuid := app_current_pool_id();
BEGIN
  IF pool IS NULL THEN
    RAISE EXCEPTION 'request_pool_job needs a pool context' USING ERRCODE = '42501';
  END IF;
  -- clock_timestamp(), not now(): now() is the start of the caller's transaction, and a long import
  -- would age the request before the worker can even see it.
  INSERT INTO job_requests (pool_id, job_name, requested_at) VALUES (pool, job, clock_timestamp())
  ON CONFLICT (pool_id, job_name) DO UPDATE
    SET token = gen_random_uuid(), requested_at = clock_timestamp();
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION request_pool_job(text) FROM PUBLIC;--> statement-breakpoint
DO $grants$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION request_pool_job(text) TO app_rw;
  END IF;
END $grants$;
