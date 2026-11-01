ALTER TABLE "plans" ADD COLUMN "activated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Existing plans keep the age check NES-68 used (updated_at). The owner is bound by FORCE, so it is
-- switched off for the copy.
ALTER TABLE "plans" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "plans" SET "activated_at" = "updated_at";--> statement-breakpoint
ALTER TABLE "plans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- NES-150: reconcile worker_pools with the pools that really have accounts. reconcile_worker_pools() is
-- SECURITY DEFINER and runs as the table owner (the migration user), which FORCE RLS binds like anyone
-- else; this read-only policy, for the migration user alone, is what lets it see which pools exist.
-- app_rw and worker_rw are not covered by it. The migration user is never used by the web app or the worker.
DO $policy$ BEGIN
  EXECUTE format(
    'CREATE POLICY accounts_pool_sweep ON accounts FOR SELECT TO %I USING (true)',
    current_user
  );
END $policy$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION reconcile_worker_pools() RETURNS TABLE (added integer, removed integer)
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH inserted AS (
    INSERT INTO worker_pools (pool_id) SELECT DISTINCT pool_id FROM accounts
    ON CONFLICT DO NOTHING RETURNING 1
  ), deleted AS (
    DELETE FROM worker_pools w WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.pool_id = w.pool_id)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM inserted)::integer, (SELECT count(*) FROM deleted)::integer
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION reconcile_worker_pools() FROM PUBLIC;--> statement-breakpoint
DO $grants$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'worker_rw') THEN
    GRANT EXECUTE ON FUNCTION reconcile_worker_pools() TO worker_rw;
  END IF;
END $grants$;
