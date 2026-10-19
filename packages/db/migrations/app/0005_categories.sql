CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid,
	"system_key" text,
	"name" text,
	"kind" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_scope" CHECK (("categories"."pool_id" is null and "categories"."system_key" is not null and "categories"."name" is null) or ("categories"."pool_id" is not null and "categories"."name" is not null and "categories"."system_key" is null)),
	CONSTRAINT "categories_kind" CHECK ("categories"."kind" in ('expense', 'income', 'refund', 'transfer', 'invest')),
	CONSTRAINT "categories_color_hex" CHECK ("categories"."color" ~ '^#[0-9A-Fa-f]{6}$'),
	CONSTRAINT "categories_name_len" CHECK ("categories"."name" is null or char_length("categories"."name") between 1 and 60),
	CONSTRAINT "categories_system_key_format" CHECK ("categories"."system_key" ~ '^[a-z][a-z0-9-]{1,39}$')
);
--> statement-breakpoint
CREATE TABLE "pool_category_settings" (
	"pool_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"monthly_budget" numeric(18, 4),
	"color_override" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pool_category_settings_pool_id_category_id_pk" PRIMARY KEY("pool_id","category_id"),
	CONSTRAINT "pool_category_settings_budget" CHECK ("pool_category_settings"."monthly_budget" >= 0),
	CONSTRAINT "pool_category_settings_color_hex" CHECK ("pool_category_settings"."color_override" is null or "pool_category_settings"."color_override" ~ '^#[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
ALTER TABLE "pool_category_settings" ADD CONSTRAINT "pool_category_settings_category_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_pool_idx" ON "categories" USING btree ("pool_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_system_key_uniq" ON "categories" USING btree ("system_key") WHERE "categories"."pool_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_pool_name_uniq" ON "categories" USING btree ("pool_id","name") WHERE "categories"."pool_id" is not null;
--> statement-breakpoint
-- RLS on categories: every pool reads the global rows (pool_id null) and its own, but writes only
-- its own. One policy per command: a single FOR ALL policy would let a pool UPDATE a global row
-- into one of its own, because its USING clause passes for global rows.
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "categories_select" ON "categories" FOR SELECT
  USING ("pool_id" IS NULL OR "pool_id" = app_current_pool_id());--> statement-breakpoint
CREATE POLICY "categories_insert" ON "categories" FOR INSERT
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
CREATE POLICY "categories_update" ON "categories" FOR UPDATE
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
CREATE POLICY "categories_delete" ON "categories" FOR DELETE
  USING ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "categories" TO app_rw;--> statement-breakpoint
-- The global catalogue (25 defaults, ADR 0004). The owner would be bound by its own policies
-- (FORCE), so the seed runs with FORCE off and turns it back on.
ALTER TABLE "categories" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO "categories" ("id", "system_key", "kind", "color") VALUES
  ('019a0000-0000-7000-8000-000000000001', 'housing', 'expense', '#6C5CFF'),
  ('019a0000-0000-7000-8000-000000000002', 'groceries', 'expense', '#F2913D'),
  ('019a0000-0000-7000-8000-000000000003', 'dining', 'expense', '#E356A8'),
  ('019a0000-0000-7000-8000-000000000004', 'transport', 'expense', '#3BA7F2'),
  ('019a0000-0000-7000-8000-000000000005', 'fuel', 'expense', '#5B8DEF'),
  ('019a0000-0000-7000-8000-000000000006', 'utilities', 'expense', '#F2C43D'),
  ('019a0000-0000-7000-8000-000000000007', 'telecoms', 'expense', '#2BC6B4'),
  ('019a0000-0000-7000-8000-000000000008', 'subscriptions', 'expense', '#9D6BFF'),
  ('019a0000-0000-7000-8000-000000000009', 'health', 'expense', '#3CCB7F'),
  ('019a0000-0000-7000-8000-000000000010', 'education', 'expense', '#FF7A59'),
  ('019a0000-0000-7000-8000-000000000011', 'insurance', 'expense', '#8C8FB8'),
  ('019a0000-0000-7000-8000-000000000012', 'shopping', 'expense', '#E5424D'),
  ('019a0000-0000-7000-8000-000000000013', 'leisure-travel', 'expense', '#F2913D'),
  ('019a0000-0000-7000-8000-000000000014', 'sports', 'expense', '#3CCB7F'),
  ('019a0000-0000-7000-8000-000000000015', 'taxes', 'expense', '#8C8FB8'),
  ('019a0000-0000-7000-8000-000000000016', 'cash-withdrawals', 'expense', '#C9A227'),
  ('019a0000-0000-7000-8000-000000000017', 'bank-fees', 'expense', '#7779A6'),
  ('019a0000-0000-7000-8000-000000000018', 'other-expenses', 'expense', '#8C8FB8'),
  ('019a0000-0000-7000-8000-000000000019', 'salary', 'income', '#3CCB7F'),
  ('019a0000-0000-7000-8000-000000000020', 'interest', 'income', '#2BC6B4'),
  ('019a0000-0000-7000-8000-000000000021', 'other-income', 'income', '#3BA7F2'),
  ('019a0000-0000-7000-8000-000000000022', 'external-transfers', 'expense', '#C9A227'),
  ('019a0000-0000-7000-8000-000000000023', 'refunds', 'refund', '#2BC6B4'),
  ('019a0000-0000-7000-8000-000000000024', 'internal-transfer', 'transfer', '#7779A6'),
  ('019a0000-0000-7000-8000-000000000025', 'investment', 'invest', '#9D6BFF');--> statement-breakpoint
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pool_category_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pool_category_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- The category must be visible to the pool (its own or global): the subquery runs under the
-- categories policies, which closes what the plain foreign key cannot (no pool_id on global rows).
CREATE POLICY "pool_category_settings_pool_isolation" ON "pool_category_settings"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK (
    "pool_id" = app_current_pool_id()
    AND EXISTS (SELECT 1 FROM "categories" c WHERE c."id" = "category_id")
  );--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "pool_category_settings" TO app_rw;
