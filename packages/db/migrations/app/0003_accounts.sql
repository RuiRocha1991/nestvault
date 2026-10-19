ALTER TABLE "holders" ADD CONSTRAINT "holders_pool_id_uniq" UNIQUE("pool_id","id");--> statement-breakpoint
CREATE TABLE "account_holders" (
	"pool_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"holder_id" uuid NOT NULL,
	CONSTRAINT "account_holders_account_id_holder_id_pk" PRIMARY KEY("account_id","holder_id")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"institution" text,
	"iban" text,
	"ccy" text NOT NULL,
	"opening" numeric(18, 4) DEFAULT '0' NOT NULL,
	"opening_date" date,
	"track_cash" boolean DEFAULT true NOT NULL,
	"group_name" text,
	"portfolio_id" uuid,
	"rate" numeric(9, 6),
	"xtb_account_no" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_pool_id_uniq" UNIQUE("pool_id","id"),
	CONSTRAINT "accounts_type" CHECK ("accounts"."type" in ('checking', 'savings', 'term_deposit', 'brokerage')),
	CONSTRAINT "accounts_name_len" CHECK (char_length("accounts"."name") between 1 and 80),
	CONSTRAINT "accounts_iban_format" CHECK ("accounts"."iban" ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
	CONSTRAINT "accounts_currency_format" CHECK ("accounts"."ccy" ~ '^[A-Z]{3}$'),
	CONSTRAINT "accounts_term_deposit_eur" CHECK ("accounts"."type" <> 'term_deposit' or "accounts"."ccy" = 'EUR'),
	CONSTRAINT "accounts_rate_range" CHECK ("accounts"."rate" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "sub_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"holder_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sub_accounts_pool_id_uniq" UNIQUE("pool_id","id"),
	CONSTRAINT "sub_accounts_account_name_uniq" UNIQUE("account_id","name"),
	CONSTRAINT "sub_accounts_name_len" CHECK (char_length("sub_accounts"."name") between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "account_holders" ADD CONSTRAINT "account_holders_account_fk" FOREIGN KEY ("pool_id","account_id") REFERENCES "public"."accounts"("pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_holders" ADD CONSTRAINT "account_holders_holder_fk" FOREIGN KEY ("pool_id","holder_id") REFERENCES "public"."holders"("pool_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_accounts" ADD CONSTRAINT "sub_accounts_account_fk" FOREIGN KEY ("pool_id","account_id") REFERENCES "public"."accounts"("pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_accounts" ADD CONSTRAINT "sub_accounts_holder_fk" FOREIGN KEY ("pool_id","holder_id") REFERENCES "public"."holders"("pool_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_holders_pool_idx" ON "account_holders" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "account_holders_holder_idx" ON "account_holders" USING btree ("pool_id","holder_id");--> statement-breakpoint
CREATE INDEX "accounts_pool_idx" ON "accounts" USING btree ("pool_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_pool_iban_uniq" ON "accounts" USING btree ("pool_id","iban") WHERE "accounts"."iban" is not null;--> statement-breakpoint
CREATE INDEX "sub_accounts_pool_account_idx" ON "sub_accounts" USING btree ("pool_id","account_id");
--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "accounts_pool_isolation" ON "accounts"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "accounts" TO app_rw;
--> statement-breakpoint
ALTER TABLE "account_holders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_holders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "account_holders_pool_isolation" ON "account_holders"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "account_holders" TO app_rw;
--> statement-breakpoint
ALTER TABLE "sub_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sub_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sub_accounts_pool_isolation" ON "sub_accounts"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "sub_accounts" TO app_rw;
