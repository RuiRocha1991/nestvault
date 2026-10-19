CREATE TABLE "holders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holders_name_len" CHECK (char_length("holders"."name") between 1 and 60),
	CONSTRAINT "holders_color_hex" CHECK ("holders"."color" ~ '^#[0-9A-Fa-f]{6}$'),
	CONSTRAINT "holders_aliases_max" CHECK (cardinality("holders"."aliases") <= 10)
);
--> statement-breakpoint
CREATE INDEX "holders_pool_idx" ON "holders" USING btree ("pool_id");--> statement-breakpoint
CREATE UNIQUE INDEX "holders_pool_user_uniq" ON "holders" USING btree ("pool_id","user_id") WHERE "holders"."user_id" is not null;--> statement-breakpoint
ALTER TABLE "holders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "holders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "holders_pool_isolation" ON "holders"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "holders" TO app_rw;
