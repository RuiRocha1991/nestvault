CREATE TABLE "loan_fields" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"loan_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean NOT NULL,
	"counts_as_expense" boolean DEFAULT true NOT NULL,
	"default_amount" numeric(18, 4),
	"applies_from" date,
	CONSTRAINT "loan_fields_pool_id_uniq" UNIQUE("pool_id","id"),
	CONSTRAINT "loan_fields_key_uniq" UNIQUE("pool_id","loan_id","key"),
	CONSTRAINT "loan_fields_key_format" CHECK ("loan_fields"."key" ~ '^[a-zA-Z][a-zA-Z0-9]{0,39}$'),
	CONSTRAINT "loan_fields_label_len" CHECK (char_length("loan_fields"."label") between 1 and 60),
	CONSTRAINT "loan_fields_kind_known" CHECK ("loan_fields"."kind" in ('builtin', 'custom')),
	CONSTRAINT "loan_fields_default_not_negative" CHECK ("loan_fields"."default_amount" is null or "loan_fields"."default_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "loan_installment_amounts" (
	"pool_id" uuid NOT NULL,
	"installment_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	CONSTRAINT "loan_installment_amounts_installment_id_field_id_pk" PRIMARY KEY("installment_id","field_id"),
	CONSTRAINT "loan_installment_amounts_not_negative" CHECK ("loan_installment_amounts"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "loan_installments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"loan_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"due_date" date NOT NULL,
	"capital" numeric(18, 4) NOT NULL,
	"interest" numeric(18, 4) NOT NULL,
	"fees" numeric(18, 4) DEFAULT '0' NOT NULL,
	"stamp_tax" numeric(18, 4) DEFAULT '0' NOT NULL,
	"life_insurance" numeric(18, 4) DEFAULT '0' NOT NULL,
	"home_insurance" numeric(18, 4) DEFAULT '0' NOT NULL,
	"credit_insurance" numeric(18, 4) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'paid' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loan_installments_pool_id_uniq" UNIQUE("pool_id","id"),
	CONSTRAINT "loan_installments_number_uniq" UNIQUE("pool_id","loan_id","number"),
	CONSTRAINT "loan_installments_number_positive" CHECK ("loan_installments"."number" >= 1),
	CONSTRAINT "loan_installments_amounts_not_negative" CHECK ("loan_installments"."capital" >= 0 and "loan_installments"."interest" >= 0 and "loan_installments"."fees" >= 0
        and "loan_installments"."stamp_tax" >= 0 and "loan_installments"."life_insurance" >= 0
        and "loan_installments"."home_insurance" >= 0 and "loan_installments"."credit_insurance" >= 0),
	CONSTRAINT "loan_installments_status_known" CHECK ("loan_installments"."status" in ('scheduled', 'paid')),
	CONSTRAINT "loan_installments_source_known" CHECK ("loan_installments"."source" in ('manual', 'import'))
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"property_id" uuid,
	"principal" numeric(18, 4) NOT NULL,
	"start_date" date NOT NULL,
	"first_due_date" date NOT NULL,
	"term_months" integer NOT NULL,
	"rate_type" text NOT NULL,
	"rate_index" text,
	"spread" numeric(9, 6),
	"annual_rate" numeric(9, 6) NOT NULL,
	"fixed_until" date,
	"review_months" integer,
	"payment_day" integer NOT NULL,
	"debit_account_id" uuid,
	"taeg" numeric(9, 6),
	"tan" numeric(9, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loans_pool_id_uniq" UNIQUE("pool_id","id"),
	CONSTRAINT "loans_name_len" CHECK (char_length("loans"."name") between 1 and 80),
	CONSTRAINT "loans_kind_known" CHECK ("loans"."kind" in ('mortgage', 'car', 'personal')),
	CONSTRAINT "loans_principal_positive" CHECK ("loans"."principal" > 0),
	CONSTRAINT "loans_term_range" CHECK ("loans"."term_months" between 1 and 600),
	CONSTRAINT "loans_rate_type_known" CHECK ("loans"."rate_type" in ('fixed', 'variable', 'mixed')),
	CONSTRAINT "loans_rate_index_known" CHECK ("loans"."rate_index" is null or "loans"."rate_index" in ('euribor_3m', 'euribor_6m', 'euribor_12m')),
	CONSTRAINT "loans_annual_rate_range" CHECK ("loans"."annual_rate" between 0 and 100),
	CONSTRAINT "loans_spread_range" CHECK ("loans"."spread" is null or "loans"."spread" between -10 and 100),
	CONSTRAINT "loans_review_range" CHECK ("loans"."review_months" is null or "loans"."review_months" between 1 and 24),
	CONSTRAINT "loans_payment_day_range" CHECK ("loans"."payment_day" between 1 and 28),
	CONSTRAINT "loans_taeg_range" CHECK ("loans"."taeg" is null or "loans"."taeg" between 0 and 100),
	CONSTRAINT "loans_tan_range" CHECK ("loans"."tan" is null or "loans"."tan" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "loan_fields" ADD CONSTRAINT "loan_fields_loan_fk" FOREIGN KEY ("pool_id","loan_id") REFERENCES "public"."loans"("pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_installment_amounts" ADD CONSTRAINT "loan_installment_amounts_installment_fk" FOREIGN KEY ("pool_id","installment_id") REFERENCES "public"."loan_installments"("pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_installment_amounts" ADD CONSTRAINT "loan_installment_amounts_field_fk" FOREIGN KEY ("pool_id","field_id") REFERENCES "public"."loan_fields"("pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_installments" ADD CONSTRAINT "loan_installments_loan_fk" FOREIGN KEY ("pool_id","loan_id") REFERENCES "public"."loans"("pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_property_fk" FOREIGN KEY ("pool_id","property_id") REFERENCES "public"."properties"("pool_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_debit_account_fk" FOREIGN KEY ("pool_id","debit_account_id") REFERENCES "public"."accounts"("pool_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loan_fields_pool_loan_idx" ON "loan_fields" USING btree ("pool_id","loan_id");--> statement-breakpoint
CREATE INDEX "loan_installment_amounts_pool_idx" ON "loan_installment_amounts" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "loan_installments_pool_loan_idx" ON "loan_installments" USING btree ("pool_id","loan_id","number");--> statement-breakpoint
CREATE INDEX "loans_pool_idx" ON "loans" USING btree ("pool_id");--> statement-breakpoint
ALTER TABLE "loans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "loans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "loans_pool_isolation" ON "loans"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "loans" TO app_rw;--> statement-breakpoint
ALTER TABLE "loan_fields" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "loan_fields" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "loan_fields_pool_isolation" ON "loan_fields"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "loan_fields" TO app_rw;--> statement-breakpoint
ALTER TABLE "loan_installments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "loan_installments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "loan_installments_pool_isolation" ON "loan_installments"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "loan_installments" TO app_rw;--> statement-breakpoint
ALTER TABLE "loan_installment_amounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "loan_installment_amounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "loan_installment_amounts_pool_isolation" ON "loan_installment_amounts"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "loan_installment_amounts" TO app_rw;
