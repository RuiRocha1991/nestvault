CREATE TABLE "rate_limits" (
	"bucket" text NOT NULL,
	"key_hash" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limits_bucket_key_hash_window_start_pk" PRIMARY KEY("bucket","key_hash","window_start")
);
--> statement-breakpoint
CREATE INDEX "rate_limits_expires_at_idx" ON "rate_limits" USING btree ("expires_at");