CREATE TABLE "goal_scopes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"portfolio_id" uuid,
	"account_id" uuid,
	"sub_account_id" uuid,
	CONSTRAINT "goal_scopes_one_kind" CHECK (("goal_scopes"."portfolio_id" is not null and "goal_scopes"."account_id" is null and "goal_scopes"."sub_account_id" is null)
        or ("goal_scopes"."portfolio_id" is null and "goal_scopes"."account_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"type" text NOT NULL,
	"target" numeric(18, 4) NOT NULL,
	"mode" text DEFAULT 'date' NOT NULL,
	"deadline" date,
	"monthly" numeric(18, 4),
	"rate" numeric(9, 6),
	"yield" numeric(9, 6),
	"include_savings" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_pool_id_uniq" UNIQUE("pool_id","id"),
	CONSTRAINT "goals_name_len" CHECK (char_length("goals"."name") between 1 and 60),
	CONSTRAINT "goals_color_format" CHECK ("goals"."color" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "goals_type_known" CHECK ("goals"."type" in ('value', 'invested', 'income', 'contrib')),
	CONSTRAINT "goals_mode_known" CHECK ("goals"."mode" in ('date', 'eta', 'none')),
	CONSTRAINT "goals_target_positive" CHECK ("goals"."target" > 0),
	CONSTRAINT "goals_monthly_not_negative" CHECK ("goals"."monthly" is null or "goals"."monthly" >= 0),
	CONSTRAINT "goals_rate_range" CHECK ("goals"."rate" is null or "goals"."rate" between 0 and 100),
	CONSTRAINT "goals_yield_range" CHECK ("goals"."yield" is null or "goals"."yield" between 0 and 100),
	CONSTRAINT "goals_deadline_needed" CHECK ("goals"."mode" <> 'date' or "goals"."deadline" is not null)
);
--> statement-breakpoint
ALTER TABLE "goal_scopes" ADD CONSTRAINT "goal_scopes_goal_fk" FOREIGN KEY ("pool_id","goal_id") REFERENCES "public"."goals"("pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_scopes" ADD CONSTRAINT "goal_scopes_portfolio_fk" FOREIGN KEY ("pool_id","portfolio_id") REFERENCES "public"."portfolios"("pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_scopes" ADD CONSTRAINT "goal_scopes_account_fk" FOREIGN KEY ("pool_id","account_id") REFERENCES "public"."accounts"("pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_scopes" ADD CONSTRAINT "goal_scopes_sub_account_fk" FOREIGN KEY ("pool_id","account_id","sub_account_id") REFERENCES "public"."sub_accounts"("pool_id","account_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goal_scopes_pool_goal_idx" ON "goal_scopes" USING btree ("pool_id","goal_id");--> statement-breakpoint
CREATE INDEX "goals_pool_idx" ON "goals" USING btree ("pool_id");--> statement-breakpoint
ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "goals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "goals_pool_isolation" ON "goals"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "goals" TO app_rw;--> statement-breakpoint
ALTER TABLE "goal_scopes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "goal_scopes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "goal_scopes_pool_isolation" ON "goal_scopes"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "goal_scopes" TO app_rw;
