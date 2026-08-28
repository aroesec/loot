CREATE TYPE "public"."person_type" AS ENUM('employee', 'contractor');--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "person_type" NOT NULL,
	"email" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "business_logo_data" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "business_logo_mime_type" text;