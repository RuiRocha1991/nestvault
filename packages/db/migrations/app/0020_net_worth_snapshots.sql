CREATE TABLE "net_worth_snapshots" (
	"pool_id" uuid NOT NULL,
	"date" date NOT NULL,
	"net" numeric(18, 4) NOT NULL,
	"cash" numeric(18, 4) NOT NULL,
	"savings" numeric(18, 4) NOT NULL,
	"investments" numeric(18, 4) NOT NULL,
	"by_ccy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "net_worth_snapshots_pool_id_date_pk" PRIMARY KEY("pool_id","date"),
	CONSTRAINT "net_worth_snapshots_by_ccy_object" CHECK (jsonb_typeof("net_worth_snapshots"."by_ccy") = 'object')
);
--> statement-breakpoint
ALTER TABLE "net_worth_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "net_worth_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "net_worth_snapshots_pool_isolation" ON "net_worth_snapshots"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "net_worth_snapshots" TO app_rw;
