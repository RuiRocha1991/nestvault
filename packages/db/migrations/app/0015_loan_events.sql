CREATE TABLE "loan_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"loan_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"date" date NOT NULL,
	"effective_from" date NOT NULL,
	"amount" numeric(18, 4),
	"fee" numeric(18, 4),
	"effect" text,
	"index_value" numeric(9, 6),
	"spread" numeric(9, 6),
	"annual_rate" numeric(9, 6),
	"new_installment" numeric(18, 4),
	"term_months" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loan_events_pool_id_uniq" UNIQUE("pool_id","id"),
	CONSTRAINT "loan_events_kind_known" CHECK ("loan_events"."kind" in ('prepayment', 'rate_review', 'renegotiation')),
	CONSTRAINT "loan_events_effective_after_date" CHECK ("loan_events"."effective_from" >= "loan_events"."date"),
	CONSTRAINT "loan_events_prepayment_shape" CHECK ("loan_events"."kind" <> 'prepayment' or ("loan_events"."amount" > 0
        and "loan_events"."effect" in ('reduce_installment', 'reduce_term')
        and "loan_events"."annual_rate" is null and "loan_events"."term_months" is null) is true),
	CONSTRAINT "loan_events_prepayment_only_fields" CHECK ("loan_events"."kind" = 'prepayment' or ("loan_events"."amount" is null and "loan_events"."fee" is null and "loan_events"."effect" is null)),
	CONSTRAINT "loan_events_review_shape" CHECK ("loan_events"."kind" <> 'rate_review' or ("loan_events"."annual_rate" is not null and "loan_events"."term_months" is null)),
	CONSTRAINT "loan_events_renegotiation_shape" CHECK ("loan_events"."kind" <> 'renegotiation' or "loan_events"."annual_rate" is not null or "loan_events"."term_months" is not null),
	CONSTRAINT "loan_events_fee_not_negative" CHECK ("loan_events"."fee" is null or "loan_events"."fee" >= 0),
	CONSTRAINT "loan_events_installment_positive" CHECK ("loan_events"."new_installment" is null or "loan_events"."new_installment" > 0),
	CONSTRAINT "loan_events_rate_range" CHECK (("loan_events"."annual_rate" is null or "loan_events"."annual_rate" between 0 and 100)
        and ("loan_events"."index_value" is null or "loan_events"."index_value" between -10 and 100)
        and ("loan_events"."spread" is null or "loan_events"."spread" between -10 and 100)),
	CONSTRAINT "loan_events_term_range" CHECK ("loan_events"."term_months" is null or "loan_events"."term_months" between 1 and 600)
);
--> statement-breakpoint
CREATE TABLE "index_rates" (
	"rate_index" text NOT NULL,
	"period" date NOT NULL,
	"rate" numeric(9, 6) NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "index_rates_rate_index_period_pk" PRIMARY KEY("rate_index","period"),
	CONSTRAINT "index_rates_index_known" CHECK ("index_rates"."rate_index" in ('euribor_3m', 'euribor_6m', 'euribor_12m')),
	CONSTRAINT "index_rates_first_of_month" CHECK (extract(day from "index_rates"."period") = 1),
	CONSTRAINT "index_rates_rate_range" CHECK ("index_rates"."rate" between -10 and 100),
	CONSTRAINT "index_rates_source_known" CHECK ("index_rates"."source" in ('ecb', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "loan_events" ADD CONSTRAINT "loan_events_loan_fk" FOREIGN KEY ("pool_id","loan_id") REFERENCES "public"."loans"("pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loan_events_pool_loan_idx" ON "loan_events" USING btree ("pool_id","loan_id","effective_from");--> statement-breakpoint
ALTER TABLE "loan_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "loan_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "loan_events_pool_isolation" ON "loan_events"
  USING (pool_id = app_current_pool_id())
  WITH CHECK (pool_id = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "loan_events" TO app_rw;--> statement-breakpoint
-- index_rates is global reference data: the default privileges gave app_rw full DML on every new
-- table, so the write privileges are taken back and only SELECT stays. The worker writes it.
REVOKE ALL ON "index_rates" FROM app_rw;--> statement-breakpoint
GRANT SELECT ON "index_rates" TO app_rw;
