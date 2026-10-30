CREATE TABLE "works_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"planned_date" date,
	"paid_date" date,
	"status" text DEFAULT 'planned' NOT NULL,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "works_payments_pool_id_uniq" UNIQUE("pool_id","id"),
	CONSTRAINT "works_payments_description_len" CHECK (char_length("works_payments"."description") between 1 and 120),
	CONSTRAINT "works_payments_amount_positive" CHECK ("works_payments"."amount" > 0),
	CONSTRAINT "works_payments_status_known" CHECK ("works_payments"."status" in ('planned', 'paid')),
	CONSTRAINT "works_payments_paid_has_date" CHECK ("works_payments"."status" <> 'paid' or "works_payments"."paid_date" is not null),
	CONSTRAINT "works_payments_planned_has_no_paid_date" CHECK ("works_payments"."status" <> 'planned' or "works_payments"."paid_date" is null),
	CONSTRAINT "works_payments_transaction_means_paid" CHECK ("works_payments"."transaction_id" is null or "works_payments"."status" = 'paid')
);
--> statement-breakpoint
CREATE TABLE "works_projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"supplier" text,
	"budget" numeric(18, 4) NOT NULL,
	"deposit_pct" numeric(9, 6),
	"status" text DEFAULT 'planned' NOT NULL,
	"start_date" date,
	"planned_end" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "works_projects_pool_id_uniq" UNIQUE("pool_id","id"),
	CONSTRAINT "works_projects_name_len" CHECK (char_length("works_projects"."name") between 1 and 80),
	CONSTRAINT "works_projects_supplier_len" CHECK ("works_projects"."supplier" is null or char_length("works_projects"."supplier") between 1 and 80),
	CONSTRAINT "works_projects_budget_not_negative" CHECK ("works_projects"."budget" >= 0),
	CONSTRAINT "works_projects_deposit_range" CHECK ("works_projects"."deposit_pct" is null or "works_projects"."deposit_pct" between 0 and 100),
	CONSTRAINT "works_projects_status_known" CHECK ("works_projects"."status" in ('planned', 'in_progress', 'done')),
	CONSTRAINT "works_projects_dates_in_order" CHECK ("works_projects"."start_date" is null or "works_projects"."planned_end" is null or "works_projects"."planned_end" >= "works_projects"."start_date")
);
--> statement-breakpoint
ALTER TABLE "works_payments" ADD CONSTRAINT "works_payments_project_fk" FOREIGN KEY ("pool_id","project_id") REFERENCES "public"."works_projects"("pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_payments" ADD CONSTRAINT "works_payments_transaction_fk" FOREIGN KEY ("pool_id","transaction_id") REFERENCES "public"."transactions"("pool_id","id") ON DELETE set null ("transaction_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_projects" ADD CONSTRAINT "works_projects_property_fk" FOREIGN KEY ("pool_id","property_id") REFERENCES "public"."properties"("pool_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "works_payments_pool_project_idx" ON "works_payments" USING btree ("pool_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "works_payments_transaction_uniq" ON "works_payments" USING btree ("pool_id","transaction_id") WHERE "works_payments"."transaction_id" is not null;--> statement-breakpoint
CREATE INDEX "works_projects_pool_property_idx" ON "works_projects" USING btree ("pool_id","property_id");--> statement-breakpoint
ALTER TABLE "works_projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "works_projects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "works_projects_pool_isolation" ON "works_projects"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "works_projects" TO app_rw;--> statement-breakpoint
ALTER TABLE "works_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "works_payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "works_payments_pool_isolation" ON "works_payments"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "works_payments" TO app_rw;--> statement-breakpoint
-- The global category "Obras" (ADR 0004): a bank movement linked to a works payment gets it. Same
-- seed procedure as the catalogue's migration: the owner is bound by its own policies (FORCE), so the
-- insert runs with FORCE off and turns it back on.
ALTER TABLE "categories" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO "categories" ("id", "system_key", "kind", "color") VALUES
  ('019a0000-0000-7000-8000-000000000026', 'works', 'expense', '#C9A227');--> statement-breakpoint
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;
