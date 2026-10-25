CREATE TABLE "income_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"account_id" uuid NOT NULL,
	"pattern" text NOT NULL,
	"effective_month" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"payments_per_month" integer DEFAULT 2 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "income_plans" ADD CONSTRAINT "income_plans_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "income_plans_source_month_key" ON "income_plans" USING btree ("source_id","effective_month");