CREATE TYPE "public"."ledger_mode" AS ENUM('personal', 'business');--> statement-breakpoint
CREATE TYPE "public"."pl_section" AS ENUM('revenue', 'cogs', 'opex', 'owner_equity', 'other');--> statement-breakpoint
DROP INDEX "merchant_rules_pattern_key";--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "mode" "ledger_mode" DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "pl_section" "pl_section";--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "deductible_pct" integer;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "schedule_c_line" text;--> statement-breakpoint
ALTER TABLE "merchant_rules" ADD COLUMN "mode" "ledger_mode" DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "ledger_mode" "ledger_mode" DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "business_name" text;--> statement-breakpoint
CREATE INDEX "categories_mode_idx" ON "categories" USING btree ("mode");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_rules_pattern_key" ON "merchant_rules" USING btree ("pattern","match_type","applies_to","mode");