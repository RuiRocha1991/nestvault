ALTER TABLE "transactions" ADD COLUMN "loan_installment_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_loan_installment_fk" FOREIGN KEY ("pool_id","loan_installment_id") REFERENCES "public"."loan_installments"("pool_id","id") ON DELETE set null ("loan_installment_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_loan_installment_uniq" ON "transactions" USING btree ("pool_id","loan_installment_id") WHERE "transactions"."loan_installment_id" is not null;
--> statement-breakpoint
-- The global category "Crédito habitação — juros" (ADR 0004): where the interest of a linked
-- installment is counted. Same seed procedure as the catalogue's migration: the owner is bound by
-- its own policies (FORCE), so the insert runs with FORCE off and turns it back on.
ALTER TABLE "categories" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO "categories" ("id", "system_key", "kind", "color") VALUES
  ('019a0000-0000-7000-8000-000000000027', 'mortgage-interest', 'expense', '#6C5CFF');--> statement-breakpoint
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;
