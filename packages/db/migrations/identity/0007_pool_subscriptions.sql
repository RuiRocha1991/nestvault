CREATE TABLE "pool_subscriptions" (
	"pool_id" uuid PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"provider" text,
	"provider_customer_id" text,
	"provider_subscription_id" text,
	"current_period_end" timestamp with time zone,
	"cancel_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pool_subscriptions_plan_check" CHECK ("pool_subscriptions"."plan" in ('free', 'pro')),
	CONSTRAINT "pool_subscriptions_status_check" CHECK ("pool_subscriptions"."status" in ('active', 'past_due', 'canceled'))
);
--> statement-breakpoint
ALTER TABLE "pool_subscriptions" ADD CONSTRAINT "pool_subscriptions_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE cascade ON UPDATE no action;