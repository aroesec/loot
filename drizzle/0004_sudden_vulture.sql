CREATE TYPE "public"."plaid_item_status" AS ENUM('active', 'needs_reauth', 'disconnected');--> statement-breakpoint
CREATE TABLE "plaid_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" text NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"institution_id" text,
	"institution_name" text,
	"cursor" text,
	"status" "plaid_item_status" DEFAULT 'active' NOT NULL,
	"error_code" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plaid_items_item_id_unique" UNIQUE("item_id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "plaid_account_id" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "plaid_item_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "plaid_transaction_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_plaid_id_key" ON "transactions" USING btree ("plaid_transaction_id");