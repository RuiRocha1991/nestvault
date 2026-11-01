ALTER TABLE "plans" ADD COLUMN "activated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Backfill of the activation date. Plans are not reminded for months before the first day of the current
-- month (Lisbon) after this deploy: NES-68 only ever looked at the current month, so counting plans from
-- their last edit (possibly months ago) would raise a burst of old reminders at once. A plan edited this
-- month keeps its edit time. The owner is bound by FORCE, so it is switched off for the copy.
ALTER TABLE "plans" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "plans" SET "activated_at" = GREATEST("updated_at", date_trunc('month', now() AT TIME ZONE 'Europe/Lisbon') AT TIME ZONE 'Europe/Lisbon');--> statement-breakpoint
ALTER TABLE "plans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- NES-150: reconcile worker_pools with the pools that have data in accounts, portfolios or plans (the
-- same tables whose inserts register a pool, see the triggers below). reconcile_worker_pools() is
-- SECURITY DEFINER and runs as the table owner (nestvault_migrator), which FORCE RLS binds like anyone
-- else. STANDING GRANT: these three read-only policies, addressed to nestvault_migrator by name, let that
-- one role read every pool's accounts, portfolios and plans (ids are all the function selects). They
-- exist so the function can work; app_rw and worker_rw are not covered and still see only their pool.
-- The role is the migration user, never used by the web app or the worker; if it does not exist (a
-- setup with another owner) the policies are skipped and the function sees nothing until they are added.
DO $policy$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nestvault_migrator') THEN
    CREATE POLICY accounts_pool_sweep ON accounts FOR SELECT TO nestvault_migrator USING (true);
    CREATE POLICY portfolios_pool_sweep ON portfolios FOR SELECT TO nestvault_migrator USING (true);
    CREATE POLICY plans_pool_sweep ON plans FOR SELECT TO nestvault_migrator USING (true);
  ELSE
    RAISE WARNING 'role nestvault_migrator not found: pool sweep policies not created';
  END IF;
END $policy$;--> statement-breakpoint
-- A pool with portfolios or plans is registered like one with accounts (same function as accounts).
CREATE TRIGGER portfolios_register_worker_pool AFTER INSERT ON "portfolios"
  FOR EACH ROW EXECUTE FUNCTION register_worker_pool();--> statement-breakpoint
CREATE TRIGGER plans_register_worker_pool AFTER INSERT ON "plans"
  FOR EACH ROW EXECUTE FUNCTION register_worker_pool();--> statement-breakpoint
-- The table lock serializes this with the register triggers: an account (or portfolio, or plan) being
-- inserted in a transaction that has not committed makes the lock wait, and the statement after it
-- takes its snapshot only then. Without it, a pool whose first row commits during the DELETE could lose
-- its worker_pools row until the next run. The triggers' inserts wait for this function in turn.
CREATE OR REPLACE FUNCTION reconcile_worker_pools() RETURNS TABLE (added integer, removed integer)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  LOCK TABLE worker_pools IN SHARE ROW EXCLUSIVE MODE;
  RETURN QUERY
  WITH known AS (
    SELECT pool_id FROM accounts UNION SELECT pool_id FROM portfolios UNION SELECT pool_id FROM plans
  ), inserted AS (
    INSERT INTO worker_pools (pool_id) SELECT pool_id FROM known ON CONFLICT DO NOTHING RETURNING 1
  ), deleted AS (
    DELETE FROM worker_pools w WHERE NOT EXISTS (SELECT 1 FROM known k WHERE k.pool_id = w.pool_id)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM inserted)::integer, (SELECT count(*) FROM deleted)::integer;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION reconcile_worker_pools() FROM PUBLIC;--> statement-breakpoint
DO $grants$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'worker_rw') THEN
    GRANT EXECUTE ON FUNCTION reconcile_worker_pools() TO worker_rw;
  END IF;
END $grants$;
