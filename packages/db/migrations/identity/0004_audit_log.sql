CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid,
	"user_id" uuid,
	"action" text NOT NULL,
	"target" text,
	"ip" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_log_pool_at_idx" ON "audit_log" USING btree ("pool_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_user_at_idx" ON "audit_log" USING btree ("user_id","at" DESC NULLS LAST);--> statement-breakpoint
-- Insert-only: the runtime user keeps SELECT and INSERT (from the default privileges) and loses
-- everything that could rewrite or erase history. TRUNCATE is revoked explicitly as well.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log" FROM identity_rw;
