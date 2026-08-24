CREATE TYPE "public"."entry_source" AS ENUM('statement', 'manual');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('pending', 'cleared');--> statement-breakpoint
CREATE TABLE "mcp_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "entry_source" "entry_source" DEFAULT 'statement' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "status" "transaction_status" DEFAULT 'cleared' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reconciliation_note" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "logged_amount_cents" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_tokens_hash_key" ON "mcp_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "transactions_pending_idx" ON "transactions" USING btree ("status","posted_on");