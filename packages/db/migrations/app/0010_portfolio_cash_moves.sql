CREATE TABLE "portfolio_cash_moves" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"note" text,
	"transaction_id" uuid,
	"mirror" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_cash_moves_pool_id_uniq" UNIQUE("pool_id","id"),
	CONSTRAINT "portfolio_cash_moves_amount_nonzero" CHECK ("portfolio_cash_moves"."amount" <> 0),
	CONSTRAINT "portfolio_cash_moves_note_len" CHECK ("portfolio_cash_moves"."note" is null or char_length("portfolio_cash_moves"."note") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "portfolio_cash_moves" ADD CONSTRAINT "portfolio_cash_moves_portfolio_fk" FOREIGN KEY ("pool_id","portfolio_id") REFERENCES "public"."portfolios"("pool_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_cash_moves" ADD CONSTRAINT "portfolio_cash_moves_account_fk" FOREIGN KEY ("pool_id","account_id") REFERENCES "public"."accounts"("pool_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_cash_moves" ADD CONSTRAINT "portfolio_cash_moves_transaction_fk" FOREIGN KEY ("pool_id","transaction_id") REFERENCES "public"."transactions"("pool_id","id") ON DELETE set null ("transaction_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portfolio_cash_moves_pool_portfolio_date_idx" ON "portfolio_cash_moves" USING btree ("pool_id","portfolio_id","date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "portfolio_cash_moves_pool_account_idx" ON "portfolio_cash_moves" USING btree ("pool_id","account_id");--> statement-breakpoint
ALTER TABLE "portfolio_cash_moves" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "portfolio_cash_moves" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "portfolio_cash_moves_pool_isolation" ON "portfolio_cash_moves"
  USING ("pool_id" = app_current_pool_id())
  WITH CHECK ("pool_id" = app_current_pool_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "portfolio_cash_moves" TO app_rw;
