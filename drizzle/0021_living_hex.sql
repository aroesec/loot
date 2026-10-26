CREATE TABLE "expense_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_key" text NOT NULL,
	"account_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"merchant" text NOT NULL,
	"name" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"effective_month" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_plans" ADD CONSTRAINT "expense_plans_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_plans" ADD CONSTRAINT "expense_plans_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_plans_source_month_key" ON "expense_plans" USING btree ("source_key","effective_month");