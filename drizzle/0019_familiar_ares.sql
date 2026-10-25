CREATE TABLE "funds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"funding_account_id" uuid NOT NULL,
	"destination_account_id" uuid,
	"patterns" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "fund_id" uuid;--> statement-breakpoint
ALTER TABLE "funds" ADD CONSTRAINT "funds_funding_account_id_accounts_id_fk" FOREIGN KEY ("funding_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funds" ADD CONSTRAINT "funds_destination_account_id_accounts_id_fk" FOREIGN KEY ("destination_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE set null ON UPDATE no action;