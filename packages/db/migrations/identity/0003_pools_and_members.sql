CREATE TABLE "pool_members" (
	"pool_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pool_members_pool_id_user_id_pk" PRIMARY KEY("pool_id","user_id"),
	CONSTRAINT "pool_members_role_check" CHECK ("pool_members"."role" in ('owner', 'admin', 'member', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "pools" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "active_pool_id" uuid;--> statement-breakpoint
ALTER TABLE "pool_members" ADD CONSTRAINT "pool_members_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_members" ADD CONSTRAINT "pool_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pool_members_user_id_idx" ON "pool_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_active_pool_id_pools_id_fk" FOREIGN KEY ("active_pool_id") REFERENCES "public"."pools"("id") ON DELETE set null ON UPDATE no action;