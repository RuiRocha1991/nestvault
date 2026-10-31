CREATE TABLE "notification_reads" (
	"pool_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_reads_notification_id_user_id_pk" PRIMARY KEY("notification_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"plan_id" uuid,
	"period" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "notifications_pool_id_uniq" UNIQUE("pool_id","id"),
	CONSTRAINT "notifications_kind_known" CHECK ("notifications"."kind" in ('plan_reminder')),
	CONSTRAINT "notifications_plan_reminder_shape" CHECK ("notifications"."kind" <> 'plan_reminder' or ("notifications"."plan_id" is not null and "notifications"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'))
);
--> statement-breakpoint
CREATE TABLE "worker_pools" (
	"pool_id" uuid PRIMARY KEY NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "deposit_flow_key" text;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_notification_fk" FOREIGN KEY ("pool_id","notification_id") REFERENCES "public"."notifications"("pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_plan_fk" FOREIGN KEY ("pool_id","plan_id") REFERENCES "public"."plans"("pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_reads_pool_user_idx" ON "notification_reads" USING btree ("pool_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_plan_period_uniq" ON "notifications" USING btree ("pool_id","plan_id","period") WHERE "notifications"."kind" = 'plan_reminder';--> statement-breakpoint
CREATE INDEX "notifications_pool_open_idx" ON "notifications" USING btree ("pool_id","created_at" DESC NULLS LAST) WHERE "notifications"."resolved_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_deposit_flow_uniq" ON "transactions" USING btree ("pool_id","deposit_flow_key") WHERE "transactions"."deposit_flow_key" is not null;--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "notifications_pool_isolation" ON "notifications"
  USING (pool_id = app_current_pool_id())
  WITH CHECK (pool_id = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "notifications" TO app_rw;--> statement-breakpoint
ALTER TABLE "notification_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_reads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "notification_reads_pool_isolation" ON "notification_reads"
  USING (pool_id = app_current_pool_id())
  WITH CHECK (pool_id = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "notification_reads" TO app_rw;--> statement-breakpoint
-- worker_pools is global (no pool_id, no RLS): the list of pools the worker's jobs run for. Only the
-- trigger below writes it (as the table owner); app_rw has no privilege on it, worker_rw reads it.
-- The roles may not exist yet (fresh clone before the init scripts, CI); docker/postgres/init/
-- 02-worker-role.sh repeats the worker_rw part when it creates the role later.
DO $grants$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    REVOKE ALL ON "worker_pools" FROM app_rw;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'worker_rw') THEN
    REVOKE ALL ON "worker_pools" FROM worker_rw;
    GRANT SELECT ON "worker_pools" TO worker_rw;
  END IF;
END $grants$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION register_worker_pool() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO worker_pools (pool_id) VALUES (NEW.pool_id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION register_worker_pool() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER accounts_register_worker_pool AFTER INSERT ON "accounts"
  FOR EACH ROW EXECUTE FUNCTION register_worker_pool();--> statement-breakpoint
-- Pools that already have accounts. The owner is bound by FORCE, so it is switched off for the copy.
ALTER TABLE "accounts" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO "worker_pools" ("pool_id") SELECT DISTINCT "pool_id" FROM "accounts" ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "accounts" FORCE ROW LEVEL SECURITY;