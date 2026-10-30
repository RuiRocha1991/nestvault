CREATE TABLE "property_cost_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"cost_id" uuid NOT NULL,
	"due_date" date NOT NULL,
	"transaction_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_cost_payments_occurrence_uniq" UNIQUE("pool_id","cost_id","due_date"),
	CONSTRAINT "property_cost_payments_transaction_uniq" UNIQUE("pool_id","transaction_id")
);
--> statement-breakpoint
CREATE TABLE "property_costs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text,
	"amount" numeric(18, 4) NOT NULL,
	"periodicity" text NOT NULL,
	"interval_months" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_costs_pool_id_uniq" UNIQUE("pool_id","id"),
	CONSTRAINT "property_costs_kind_known" CHECK ("property_costs"."kind" in ('insurance_home', 'insurance_life', 'imi', 'condominium', 'other')),
	CONSTRAINT "property_costs_name_len" CHECK ("property_costs"."name" is null or char_length("property_costs"."name") between 1 and 80),
	CONSTRAINT "property_costs_other_has_name" CHECK ("property_costs"."kind" <> 'other' or "property_costs"."name" is not null),
	CONSTRAINT "property_costs_amount_positive" CHECK ("property_costs"."amount" > 0),
	CONSTRAINT "property_costs_periodicity_known" CHECK ("property_costs"."periodicity" in ('monthly', 'annual', 'custom')),
	CONSTRAINT "property_costs_interval_matches" CHECK (("property_costs"."periodicity" = 'monthly' and "property_costs"."interval_months" = 1)
        or ("property_costs"."periodicity" = 'annual' and "property_costs"."interval_months" = 12)
        or ("property_costs"."periodicity" = 'custom' and "property_costs"."interval_months" between 1 and 60)),
	CONSTRAINT "property_costs_dates_in_order" CHECK ("property_costs"."end_date" is null or "property_costs"."end_date" >= "property_costs"."start_date")
);
--> statement-breakpoint
ALTER TABLE "property_cost_payments" ADD CONSTRAINT "property_cost_payments_cost_fk" FOREIGN KEY ("pool_id","cost_id") REFERENCES "public"."property_costs"("pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_cost_payments" ADD CONSTRAINT "property_cost_payments_transaction_fk" FOREIGN KEY ("pool_id","transaction_id") REFERENCES "public"."transactions"("pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_costs" ADD CONSTRAINT "property_costs_property_fk" FOREIGN KEY ("pool_id","property_id") REFERENCES "public"."properties"("pool_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_costs" ADD CONSTRAINT "property_costs_account_fk" FOREIGN KEY ("pool_id","account_id") REFERENCES "public"."accounts"("pool_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "property_cost_payments_pool_cost_idx" ON "property_cost_payments" USING btree ("pool_id","cost_id");--> statement-breakpoint
CREATE INDEX "property_costs_pool_property_idx" ON "property_costs" USING btree ("pool_id","property_id");--> statement-breakpoint
ALTER TABLE "property_costs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "property_costs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "property_costs_pool_isolation" ON "property_costs"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "property_costs" TO app_rw;--> statement-breakpoint
ALTER TABLE "property_cost_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "property_cost_payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "property_cost_payments_pool_isolation" ON "property_cost_payments"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "property_cost_payments" TO app_rw;
