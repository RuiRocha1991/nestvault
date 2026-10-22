CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"file_sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"row_count" integer NOT NULL,
	"parser_id" text NOT NULL,
	"parser_kind" text NOT NULL,
	"parser_version" text NOT NULL,
	"confidence" numeric(5, 4) NOT NULL,
	"reconciled" boolean,
	"status" text DEFAULT 'preview' NOT NULL,
	"account_id" uuid,
	"preview" jsonb,
	"spec" jsonb,
	"result" jsonb,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_batches_pool_id_uniq" UNIQUE("pool_id","id"),
	CONSTRAINT "import_batches_kind" CHECK ("import_batches"."kind" in ('bank', 'broker')),
	CONSTRAINT "import_batches_parser_kind" CHECK ("import_batches"."parser_kind" in ('bank', 'broker')),
	CONSTRAINT "import_batches_status" CHECK ("import_batches"."status" in ('preview', 'committed', 'discarded')),
	CONSTRAINT "import_batches_sha256" CHECK ("import_batches"."file_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "import_batches_file_name_len" CHECK (char_length("import_batches"."file_name") between 1 and 255),
	CONSTRAINT "import_batches_size" CHECK ("import_batches"."size_bytes" between 1 and 10485760),
	CONSTRAINT "import_batches_rows" CHECK ("import_batches"."row_count" >= 0),
	CONSTRAINT "import_batches_confidence" CHECK ("import_batches"."confidence" between 0 and 1)
);
--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_account_fk" FOREIGN KEY ("pool_id","account_id") REFERENCES "public"."accounts"("pool_id","id") ON DELETE set null ("account_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_batches_pool_status_idx" ON "import_batches" USING btree ("pool_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "import_batches_pool_sha_idx" ON "import_batches" USING btree ("pool_id","file_sha256");--> statement-breakpoint
CREATE INDEX "import_batches_pool_account_idx" ON "import_batches" USING btree ("pool_id","account_id","committed_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "import_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_batches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "import_batches_pool_isolation" ON "import_batches"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "import_batches" TO app_rw;
