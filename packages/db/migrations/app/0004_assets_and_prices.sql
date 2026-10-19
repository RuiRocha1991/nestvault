CREATE TABLE "asset_prices" (
	"pool_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"date" date NOT NULL,
	"price" numeric(18, 6) NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "asset_prices_asset_id_date_pk" PRIMARY KEY("asset_id","date"),
	CONSTRAINT "asset_prices_positive" CHECK ("asset_prices"."price" > 0),
	CONSTRAINT "asset_prices_source" CHECK ("asset_prices"."source" in ('manual', 'bulk', 'provider'))
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"symbol" text,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"ccy" text NOT NULL,
	"sector" text,
	"region" text,
	"dps" numeric(18, 4),
	"div_months" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_pool_ticker_uniq" UNIQUE("pool_id","ticker"),
	CONSTRAINT "assets_pool_id_uniq" UNIQUE("pool_id","id"),
	CONSTRAINT "assets_ticker_format" CHECK ("assets"."ticker" ~ '^[A-Z0-9][A-Z0-9.=^:_-]{0,19}$'),
	CONSTRAINT "assets_name_len" CHECK (char_length("assets"."name") between 1 and 80),
	CONSTRAINT "assets_type" CHECK ("assets"."type" in ('stock', 'etf', 'fund', 'reit', 'ppr', 'bond', 'crypto', 'other')),
	CONSTRAINT "assets_currency_format" CHECK ("assets"."ccy" ~ '^[A-Z]{3}$'),
	CONSTRAINT "assets_dps_nonneg" CHECK ("assets"."dps" >= 0),
	CONSTRAINT "assets_div_months" CHECK (cardinality("assets"."div_months") <= 12 and "assets"."div_months" <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[])
);
--> statement-breakpoint
ALTER TABLE "asset_prices" ADD CONSTRAINT "asset_prices_asset_fk" FOREIGN KEY ("pool_id","asset_id") REFERENCES "public"."assets"("pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_prices_pool_idx" ON "asset_prices" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "assets_pool_idx" ON "assets" USING btree ("pool_id");
--> statement-breakpoint
ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "assets_pool_isolation" ON "assets"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "assets" TO app_rw;
--> statement-breakpoint
ALTER TABLE "asset_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "asset_prices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "asset_prices_pool_isolation" ON "asset_prices"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "asset_prices" TO app_rw;
