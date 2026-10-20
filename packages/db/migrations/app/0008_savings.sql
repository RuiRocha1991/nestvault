CREATE TABLE "deposits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"product_id" uuid,
	"capital" numeric(18, 4) NOT NULL,
	"start_date" date NOT NULL,
	"rate" numeric(9, 6) NOT NULL,
	"pay_n" smallint,
	"pay_u" text,
	"term_n" smallint,
	"term_u" text,
	"capitalize" boolean DEFAULT false NOT NULL,
	"tax" numeric(9, 6),
	"pay_to_account_id" uuid,
	"fund_from_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposits_pool_id_uniq" UNIQUE("pool_id","id"),
	CONSTRAINT "deposits_pool_account_uniq" UNIQUE("pool_id","account_id"),
	CONSTRAINT "deposits_capital_positive" CHECK ("deposits"."capital" > 0),
	CONSTRAINT "deposits_rate_range" CHECK ("deposits"."rate" between 0 and 100),
	CONSTRAINT "deposits_tax_range" CHECK ("deposits"."tax" between 0 and 100),
	CONSTRAINT "deposits_pay_period" CHECK (("deposits"."pay_n" is null) = ("deposits"."pay_u" is null) and ("deposits"."pay_n" is null or ("deposits"."pay_n" between 1 and 3650 and "deposits"."pay_u" in ('m', 'd')))),
	CONSTRAINT "deposits_term" CHECK (("deposits"."term_n" is null) = ("deposits"."term_u" is null) and ("deposits"."term_n" is null or ("deposits"."term_n" between 1 and 3650 and "deposits"."term_u" in ('m', 'd'))))
);
--> statement-breakpoint
CREATE TABLE "interest_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interest_entries_amount_positive" CHECK ("interest_entries"."amount" > 0),
	CONSTRAINT "interest_entries_note_len" CHECK ("interest_entries"."note" is null or char_length("interest_entries"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "savings_products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"name" text NOT NULL,
	"institution" text,
	"rate" numeric(9, 6) NOT NULL,
	"pay_n" smallint,
	"pay_u" text,
	"term_n" smallint,
	"term_u" text,
	"tax" numeric(9, 6),
	"pay_to_account_id" uuid,
	"fund_from_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "savings_products_pool_id_uniq" UNIQUE("pool_id","id"),
	CONSTRAINT "savings_products_pool_name_uniq" UNIQUE("pool_id","name"),
	CONSTRAINT "savings_products_name_len" CHECK (char_length("savings_products"."name") between 1 and 80),
	CONSTRAINT "savings_products_rate_range" CHECK ("savings_products"."rate" between 0 and 100),
	CONSTRAINT "savings_products_tax_range" CHECK ("savings_products"."tax" between 0 and 100),
	CONSTRAINT "savings_products_pay_period" CHECK (("savings_products"."pay_n" is null) = ("savings_products"."pay_u" is null) and ("savings_products"."pay_n" is null or ("savings_products"."pay_n" between 1 and 3650 and "savings_products"."pay_u" in ('m', 'd')))),
	CONSTRAINT "savings_products_term" CHECK (("savings_products"."term_n" is null) = ("savings_products"."term_u" is null) and ("savings_products"."term_n" is null or ("savings_products"."term_n" between 1 and 3650 and "savings_products"."term_u" in ('m', 'd'))))
);
--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_account_fk" FOREIGN KEY ("pool_id","account_id") REFERENCES "public"."accounts"("pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_product_fk" FOREIGN KEY ("pool_id","product_id") REFERENCES "public"."savings_products"("pool_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_pay_to_fk" FOREIGN KEY ("pool_id","pay_to_account_id") REFERENCES "public"."accounts"("pool_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_fund_from_fk" FOREIGN KEY ("pool_id","fund_from_account_id") REFERENCES "public"."accounts"("pool_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_entries" ADD CONSTRAINT "interest_entries_account_fk" FOREIGN KEY ("pool_id","account_id") REFERENCES "public"."accounts"("pool_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_products" ADD CONSTRAINT "savings_products_pay_to_fk" FOREIGN KEY ("pool_id","pay_to_account_id") REFERENCES "public"."accounts"("pool_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_products" ADD CONSTRAINT "savings_products_fund_from_fk" FOREIGN KEY ("pool_id","fund_from_account_id") REFERENCES "public"."accounts"("pool_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deposits_pool_product_idx" ON "deposits" USING btree ("pool_id","product_id");--> statement-breakpoint
CREATE INDEX "interest_entries_pool_account_date_idx" ON "interest_entries" USING btree ("pool_id","account_id","date");--> statement-breakpoint
ALTER TABLE "savings_products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "savings_products" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "savings_products_pool_isolation" ON "savings_products"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "savings_products" TO app_rw;--> statement-breakpoint
ALTER TABLE "deposits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deposits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "deposits_pool_isolation" ON "deposits"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "deposits" TO app_rw;--> statement-breakpoint
ALTER TABLE "interest_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "interest_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "interest_entries_pool_isolation" ON "interest_entries"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "interest_entries" TO app_rw;
