CREATE TABLE "investment_ops" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"account_id" uuid,
	"sub_account_id" uuid,
	"type" text NOT NULL,
	"date" date NOT NULL,
	"qty" numeric(20, 8),
	"price" numeric(18, 6),
	"fee" numeric(18, 4),
	"amount" numeric(18, 4),
	"gross" numeric(18, 4),
	"tax" numeric(18, 4),
	"from_cash" boolean DEFAULT false NOT NULL,
	"plan_id" uuid,
	"plan_period" text,
	"ext_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_ops_pool_id_uniq" UNIQUE("pool_id","id"),
	CONSTRAINT "investment_ops_type" CHECK ("investment_ops"."type" in ('buy', 'sell', 'dividend')),
	CONSTRAINT "investment_ops_trade_fields" CHECK ("investment_ops"."type" not in ('buy', 'sell') or (coalesce("investment_ops"."qty" > 0, false) and coalesce("investment_ops"."price" >= 0, false))),
	CONSTRAINT "investment_ops_dividend_fields" CHECK ("investment_ops"."type" <> 'dividend' or "investment_ops"."amount" is not null),
	CONSTRAINT "investment_ops_fee_nonneg" CHECK ("investment_ops"."fee" >= 0),
	CONSTRAINT "investment_ops_sub_needs_account" CHECK ("investment_ops"."sub_account_id" is null or "investment_ops"."account_id" is not null),
	CONSTRAINT "investment_ops_ext_id_len" CHECK ("investment_ops"."ext_id" is null or char_length("investment_ops"."ext_id") between 1 and 120),
	CONSTRAINT "investment_ops_plan_period_format" CHECK ("investment_ops"."plan_period" is null or "investment_ops"."plan_period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "investment_ops_note_len" CHECK ("investment_ops"."note" is null or char_length("investment_ops"."note") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"account_id" uuid,
	"sub_account_id" uuid,
	"amount" numeric(18, 4) NOT NULL,
	"day" smallint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_pool_id_uniq" UNIQUE("pool_id","id"),
	CONSTRAINT "plans_amount_positive" CHECK ("plans"."amount" > 0),
	CONSTRAINT "plans_day_range" CHECK ("plans"."day" between 1 and 28),
	CONSTRAINT "plans_sub_needs_account" CHECK ("plans"."sub_account_id" is null or "plans"."account_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "portfolios" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"ccy" text NOT NULL,
	"note" text,
	"targets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolios_pool_id_uniq" UNIQUE("pool_id","id"),
	CONSTRAINT "portfolios_pool_name_uniq" UNIQUE("pool_id","name"),
	CONSTRAINT "portfolios_name_len" CHECK (char_length("portfolios"."name") between 1 and 60),
	CONSTRAINT "portfolios_color_format" CHECK ("portfolios"."color" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "portfolios_currency_format" CHECK ("portfolios"."ccy" ~ '^[A-Z]{3}$'),
	CONSTRAINT "portfolios_note_len" CHECK ("portfolios"."note" is null or char_length("portfolios"."note") <= 2000),
	CONSTRAINT "portfolios_targets_object" CHECK (jsonb_typeof("portfolios"."targets") = 'object')
);
--> statement-breakpoint
ALTER TABLE "sub_accounts" ADD CONSTRAINT "sub_accounts_pool_account_id_uniq" UNIQUE("pool_id","account_id","id");
ALTER TABLE "investment_ops" ADD CONSTRAINT "investment_ops_portfolio_fk" FOREIGN KEY ("pool_id","portfolio_id") REFERENCES "public"."portfolios"("pool_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_ops" ADD CONSTRAINT "investment_ops_asset_fk" FOREIGN KEY ("pool_id","asset_id") REFERENCES "public"."assets"("pool_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_ops" ADD CONSTRAINT "investment_ops_account_fk" FOREIGN KEY ("pool_id","account_id") REFERENCES "public"."accounts"("pool_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_ops" ADD CONSTRAINT "investment_ops_sub_account_fk" FOREIGN KEY ("pool_id","account_id","sub_account_id") REFERENCES "public"."sub_accounts"("pool_id","account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_ops" ADD CONSTRAINT "investment_ops_plan_fk" FOREIGN KEY ("pool_id","plan_id") REFERENCES "public"."plans"("pool_id","id") ON DELETE set null ("plan_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_portfolio_fk" FOREIGN KEY ("pool_id","portfolio_id") REFERENCES "public"."portfolios"("pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_asset_fk" FOREIGN KEY ("pool_id","asset_id") REFERENCES "public"."assets"("pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_account_fk" FOREIGN KEY ("pool_id","account_id") REFERENCES "public"."accounts"("pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_sub_account_fk" FOREIGN KEY ("pool_id","account_id","sub_account_id") REFERENCES "public"."sub_accounts"("pool_id","account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investment_ops_pool_portfolio_date_idx" ON "investment_ops" USING btree ("pool_id","portfolio_id","date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "investment_ops_pool_asset_idx" ON "investment_ops" USING btree ("pool_id","asset_id");--> statement-breakpoint
CREATE INDEX "investment_ops_pool_account_idx" ON "investment_ops" USING btree ("pool_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_ops_account_ext_uniq" ON "investment_ops" USING btree ("pool_id","account_id","ext_id") WHERE "investment_ops"."ext_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "investment_ops_plan_period_uniq" ON "investment_ops" USING btree ("pool_id","plan_id","plan_period") WHERE "investment_ops"."plan_id" is not null;--> statement-breakpoint
CREATE INDEX "plans_pool_portfolio_idx" ON "plans" USING btree ("pool_id","portfolio_id");--> statement-breakpoint
CREATE INDEX "portfolios_pool_idx" ON "portfolios" USING btree ("pool_id");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_portfolio_fk" FOREIGN KEY ("pool_id","portfolio_id") REFERENCES "public"."portfolios"("pool_id","id") ON DELETE set null ("portfolio_id") ON UPDATE no action;--> statement-breakpoint
--> statement-breakpoint
ALTER TABLE "portfolios" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "portfolios" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "portfolios_pool_isolation" ON "portfolios"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "portfolios" TO app_rw;--> statement-breakpoint
ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "plans_pool_isolation" ON "plans"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "plans" TO app_rw;--> statement-breakpoint
ALTER TABLE "investment_ops" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "investment_ops" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "investment_ops_pool_isolation" ON "investment_ops"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "investment_ops" TO app_rw;
