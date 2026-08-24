CREATE TYPE "public"."goal_kind" AS ENUM('buffer', 'sinking_fund', 'savings_target', 'debt_payoff');--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "goal_kind" NOT NULL,
	"name" text NOT NULL,
	"target_cents" bigint,
	"target_months" real,
	"monthly_contribution_cents" bigint,
	"category_id" uuid,
	"account_id" uuid,
	"target_date" date,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "balance_cents" bigint;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "available_cents" bigint;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "balance_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;