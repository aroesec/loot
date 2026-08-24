CREATE TYPE "public"."rule_direction" AS ENUM('any', 'debit', 'credit');--> statement-breakpoint
DROP INDEX "merchant_rules_pattern_key";--> statement-breakpoint
ALTER TABLE "merchant_rules" ALTER COLUMN "category_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_rules" ADD COLUMN "applies_to" "rule_direction" DEFAULT 'any' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_rules_pattern_key" ON "merchant_rules" USING btree ("pattern","match_type","applies_to");