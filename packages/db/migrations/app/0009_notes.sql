CREATE TABLE "month_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"month" date NOT NULL,
	"body" text NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "month_notes_pool_month_uniq" UNIQUE("pool_id","month"),
	CONSTRAINT "month_notes_first_day" CHECK (extract(day from "month_notes"."month") = 1),
	CONSTRAINT "month_notes_body_len" CHECK (char_length("month_notes"."body") between 1 and 10000)
);
--> statement-breakpoint
ALTER TABLE "investment_ops" ADD COLUMN "note_updated_by" uuid;--> statement-breakpoint
ALTER TABLE "investment_ops" ADD COLUMN "note_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "note_updated_by" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "note_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "month_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "month_notes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "month_notes_pool_isolation" ON "month_notes"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "month_notes" TO app_rw;