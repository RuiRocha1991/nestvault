CREATE TABLE "category_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"keyword" text NOT NULL,
	"category_id" uuid NOT NULL,
	"account_id" uuid,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_rules_keyword_len" CHECK (char_length("category_rules"."keyword") between 2 and 60)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"category_id" uuid,
	"is_transfer" boolean DEFAULT false NOT NULL,
	"pair_id" uuid,
	"kind_lock" boolean DEFAULT false NOT NULL,
	"manual_category" boolean DEFAULT false NOT NULL,
	"dep_link" boolean DEFAULT false NOT NULL,
	"hash" text NOT NULL,
	"import_batch_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_pool_id_uniq" UNIQUE("pool_id","id"),
	CONSTRAINT "transactions_description_len" CHECK (char_length("transactions"."description") between 1 and 500),
	CONSTRAINT "transactions_note_len" CHECK ("transactions"."note" is null or char_length("transactions"."note") <= 2000),
	CONSTRAINT "transactions_not_own_pair" CHECK ("transactions"."pair_id" is null or "transactions"."pair_id" <> "transactions"."id")
);
--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_category_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_account_fk" FOREIGN KEY ("pool_id","account_id") REFERENCES "public"."accounts"("pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_fk" FOREIGN KEY ("pool_id","account_id") REFERENCES "public"."accounts"("pool_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_pair_fk" FOREIGN KEY ("pool_id","pair_id") REFERENCES "public"."transactions"("pool_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_rules_pool_position_idx" ON "category_rules" USING btree ("pool_id","position","id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_account_hash_uniq" ON "transactions" USING btree ("pool_id","account_id","hash");--> statement-breakpoint
CREATE INDEX "transactions_pool_date_idx" ON "transactions" USING btree ("pool_id","date" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_pool_account_date_idx" ON "transactions" USING btree ("pool_id","account_id","date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_category_idx" ON "transactions" USING btree ("pool_id","category_id");
--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- The category must be visible to the pool (global or its own): the subquery runs under the
-- categories policies, which closes what the plain foreign key cannot (a global row has no pool).
CREATE POLICY "transactions_pool_isolation" ON "transactions"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK (
    "pool_id" = app_current_pool_id()
    AND ("category_id" IS NULL OR EXISTS (SELECT 1 FROM "categories" c WHERE c."id" = "category_id"))
  );--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "transactions" TO app_rw;--> statement-breakpoint
ALTER TABLE "category_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "category_rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "category_rules_pool_isolation" ON "category_rules"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK (
    "pool_id" = app_current_pool_id()
    AND EXISTS (SELECT 1 FROM "categories" c WHERE c."id" = "category_id")
  );--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "category_rules" TO app_rw;
