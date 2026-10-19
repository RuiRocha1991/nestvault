CREATE TABLE "fx_rates" (
	"date" date NOT NULL,
	"ccy" text NOT NULL,
	"eur_rate" numeric(18, 8) NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "fx_rates_date_ccy_pk" PRIMARY KEY("date","ccy"),
	CONSTRAINT "fx_rates_ccy_format" CHECK ("fx_rates"."ccy" ~ '^[A-Z]{3}$' and "fx_rates"."ccy" <> 'EUR'),
	CONSTRAINT "fx_rates_rate_positive" CHECK ("fx_rates"."eur_rate" > 0),
	CONSTRAINT "fx_rates_source" CHECK ("fx_rates"."source" in ('seed', 'ecb', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "pool_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"transfer_window_days" smallint DEFAULT 3 NOT NULL,
	"deposit_tax" numeric(9, 6) DEFAULT '28' NOT NULL,
	"dividend_tax" numeric(9, 6) DEFAULT '28' NOT NULL,
	"display_currency" text DEFAULT 'EUR' NOT NULL,
	"fx_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pool_settings_window" CHECK ("pool_settings"."transfer_window_days" between 0 and 30),
	CONSTRAINT "pool_settings_deposit_tax" CHECK ("pool_settings"."deposit_tax" between 0 and 100),
	CONSTRAINT "pool_settings_dividend_tax" CHECK ("pool_settings"."dividend_tax" between 0 and 100),
	CONSTRAINT "pool_settings_currency" CHECK ("pool_settings"."display_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "pool_settings_overrides_object" CHECK (jsonb_typeof("pool_settings"."fx_overrides") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pool_settings_pool_uniq" ON "pool_settings" USING btree ("pool_id");
--> statement-breakpoint
-- fx_rates is global reference data: the default privileges gave app_rw full DML on every new
-- table, so the write privileges are taken back and only SELECT stays.
REVOKE ALL ON "fx_rates" FROM app_rw;--> statement-breakpoint
GRANT SELECT ON "fx_rates" TO app_rw;--> statement-breakpoint
INSERT INTO "fx_rates" ("date", "ccy", "eur_rate", "source") VALUES
  ('2026-01-01', 'USD', 0.92, 'seed'),
  ('2026-01-01', 'GBP', 1.17, 'seed'),
  ('2026-01-01', 'CHF', 1.06, 'seed');--> statement-breakpoint
ALTER TABLE "pool_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pool_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "pool_settings_pool_isolation" ON "pool_settings"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "pool_settings" TO app_rw;
