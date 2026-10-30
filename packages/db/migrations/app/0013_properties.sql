CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"address" text,
	"purchase_date" date NOT NULL,
	"purchase_price" numeric(18, 4) NOT NULL,
	"down_payment" numeric(18, 4) DEFAULT '0' NOT NULL,
	"deed_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"imt" numeric(18, 4) DEFAULT '0' NOT NULL,
	"stamp_duty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"registration_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"bank_fees" numeric(18, 4) DEFAULT '0' NOT NULL,
	"selling_cost_pct" numeric(9, 6),
	"include_in_net_worth" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "properties_pool_id_uniq" UNIQUE("pool_id","id"),
	CONSTRAINT "properties_name_len" CHECK (char_length("properties"."name") between 1 and 80),
	CONSTRAINT "properties_type_known" CHECK ("properties"."type" in ('primary_home', 'secondary', 'rental', 'land', 'garage')),
	CONSTRAINT "properties_address_len" CHECK ("properties"."address" is null or char_length("properties"."address") between 1 and 200),
	CONSTRAINT "properties_price_positive" CHECK ("properties"."purchase_price" > 0),
	CONSTRAINT "properties_down_payment_range" CHECK ("properties"."down_payment" >= 0 and "properties"."down_payment" <= "properties"."purchase_price"),
	CONSTRAINT "properties_costs_not_negative" CHECK ("properties"."deed_cost" >= 0 and "properties"."imt" >= 0 and "properties"."stamp_duty" >= 0
        and "properties"."registration_cost" >= 0 and "properties"."bank_fees" >= 0),
	CONSTRAINT "properties_selling_cost_range" CHECK ("properties"."selling_cost_pct" is null or "properties"."selling_cost_pct" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "property_holders" (
	"pool_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"holder_id" uuid NOT NULL,
	"share_pct" numeric(9, 6) NOT NULL,
	CONSTRAINT "property_holders_property_id_holder_id_pk" PRIMARY KEY("property_id","holder_id"),
	CONSTRAINT "property_holders_share_range" CHECK ("property_holders"."share_pct" > 0 and "property_holders"."share_pct" <= 100)
);
--> statement-breakpoint
CREATE TABLE "property_valuations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"date" date NOT NULL,
	"value" numeric(18, 4) NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_valuations_day_uniq" UNIQUE("pool_id","property_id","date"),
	CONSTRAINT "property_valuations_value_positive" CHECK ("property_valuations"."value" > 0),
	CONSTRAINT "property_valuations_source_known" CHECK ("property_valuations"."source" in ('manual', 'bank_appraisal', 'estimate'))
);
--> statement-breakpoint
ALTER TABLE "property_holders" ADD CONSTRAINT "property_holders_property_fk" FOREIGN KEY ("pool_id","property_id") REFERENCES "public"."properties"("pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_holders" ADD CONSTRAINT "property_holders_holder_fk" FOREIGN KEY ("pool_id","holder_id") REFERENCES "public"."holders"("pool_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_valuations" ADD CONSTRAINT "property_valuations_property_fk" FOREIGN KEY ("pool_id","property_id") REFERENCES "public"."properties"("pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "properties_pool_idx" ON "properties" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "property_holders_pool_idx" ON "property_holders" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "property_holders_holder_idx" ON "property_holders" USING btree ("pool_id","holder_id");--> statement-breakpoint
CREATE INDEX "property_valuations_pool_property_idx" ON "property_valuations" USING btree ("pool_id","property_id","date");--> statement-breakpoint
ALTER TABLE "properties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "properties" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "properties_pool_isolation" ON "properties"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "properties" TO app_rw;--> statement-breakpoint
ALTER TABLE "property_holders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "property_holders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "property_holders_pool_isolation" ON "property_holders"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "property_holders" TO app_rw;--> statement-breakpoint
ALTER TABLE "property_valuations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "property_valuations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "property_valuations_pool_isolation" ON "property_valuations"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "property_valuations" TO app_rw;
