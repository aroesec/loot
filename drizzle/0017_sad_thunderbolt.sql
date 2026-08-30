CREATE TYPE "public"."budget_rollover" AS ENUM('none', 'under', 'both');--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "rollover" "budget_rollover" DEFAULT 'none' NOT NULL;