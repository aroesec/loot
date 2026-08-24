CREATE TYPE "public"."account_kind" AS ENUM('checking', 'savings', 'credit_card', 'investment', 'loan', 'cash');--> statement-breakpoint
CREATE TYPE "public"."cadence" AS ENUM('weekly', 'biweekly', 'monthly', 'quarterly', 'annual', 'irregular');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('expense', 'income', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."classification_source" AS ENUM('rule', 'llm', 'manual', 'unclassified');--> statement-breakpoint
CREATE TYPE "public"."insight_severity" AS ENUM('info', 'opportunity', 'warning');--> statement-breakpoint
CREATE TYPE "public"."insight_status" AS ENUM('new', 'read', 'dismissed', 'actioned');--> statement-breakpoint
CREATE TYPE "public"."match_type" AS ENUM('exact', 'contains', 'prefix', 'regex');--> statement-breakpoint
CREATE TYPE "public"."rule_source" AS ENUM('seed', 'learned', 'manual');--> statement-breakpoint
CREATE TYPE "public"."series_status" AS ENUM('active', 'ended', 'paused');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('csv', 'pdf', 'image');--> statement-breakpoint
CREATE TYPE "public"."statement_status" AS ENUM('pending', 'parsing', 'parsed', 'failed');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "account_kind" DEFAULT 'checking' NOT NULL,
	"institution" text,
	"last4" text,
	"currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" "category_kind" DEFAULT 'expense' NOT NULL,
	"parent_id" uuid,
	"hint" text,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"budgetable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"severity" "insight_severity" DEFAULT 'info' NOT NULL,
	"impact_cents" bigint DEFAULT 0 NOT NULL,
	"category_id" uuid,
	"period_month" date NOT NULL,
	"status" "insight_status" DEFAULT 'new' NOT NULL,
	"evidence" jsonb,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pattern" text NOT NULL,
	"match_type" "match_type" DEFAULT 'contains' NOT NULL,
	"category_id" uuid NOT NULL,
	"merchant_name" text,
	"priority" integer DEFAULT 100 NOT NULL,
	"source" "rule_source" DEFAULT 'manual' NOT NULL,
	"is_transfer" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"last_matched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant" text NOT NULL,
	"category_id" uuid,
	"cadence" "cadence" DEFAULT 'monthly' NOT NULL,
	"typical_amount_cents" bigint NOT NULL,
	"last_amount_cents" bigint NOT NULL,
	"first_seen_on" date NOT NULL,
	"last_seen_on" date NOT NULL,
	"next_expected_on" date,
	"occurrences" integer DEFAULT 0 NOT NULL,
	"status" "series_status" DEFAULT 'active' NOT NULL,
	"price_change_pct" real,
	"annualized_cents" bigint DEFAULT 0 NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"theme" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"monthly_income_cents" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"source_kind" "source_kind" NOT NULL,
	"byte_size" integer DEFAULT 0 NOT NULL,
	"content_hash" text NOT NULL,
	"status" "statement_status" DEFAULT 'pending' NOT NULL,
	"period_start" date,
	"period_end" date,
	"transaction_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"parse_usage" jsonb,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"parsed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"statement_id" uuid,
	"posted_on" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"raw_description" text NOT NULL,
	"merchant" text,
	"category_id" uuid,
	"classification_source" "classification_source" DEFAULT 'unclassified' NOT NULL,
	"classification_confidence" real,
	"classification_reason" text,
	"matched_rule_id" uuid,
	"is_transfer" boolean DEFAULT false NOT NULL,
	"recurring_series_id" uuid,
	"notes" text,
	"dedupe_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_rules" ADD CONSTRAINT "merchant_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_series" ADD CONSTRAINT "recurring_series_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_statement_id_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."statements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budgets_category_idx" ON "budgets" USING btree ("category_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_key" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "insights_fingerprint_key" ON "insights" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "insights_period_idx" ON "insights" USING btree ("period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_rules_pattern_key" ON "merchant_rules" USING btree ("pattern","match_type");--> statement-breakpoint
CREATE INDEX "merchant_rules_priority_idx" ON "merchant_rules" USING btree ("priority");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_series_merchant_key" ON "recurring_series" USING btree ("merchant");--> statement-breakpoint
CREATE UNIQUE INDEX "statements_content_hash_key" ON "statements" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "statements_uploaded_at_idx" ON "statements" USING btree ("uploaded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_dedupe_hash_key" ON "transactions" USING btree ("dedupe_hash");--> statement-breakpoint
CREATE INDEX "transactions_posted_on_idx" ON "transactions" USING btree ("posted_on");--> statement-breakpoint
CREATE INDEX "transactions_category_idx" ON "transactions" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "transactions_merchant_idx" ON "transactions" USING btree ("merchant");--> statement-breakpoint
CREATE INDEX "transactions_account_idx" ON "transactions" USING btree ("account_id");