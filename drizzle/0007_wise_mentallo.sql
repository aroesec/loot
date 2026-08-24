ALTER TABLE "settings" ADD COLUMN "household_adults" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "household_children" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "country" text DEFAULT 'US' NOT NULL;