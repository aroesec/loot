CREATE TABLE "fund_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fund_id" uuid NOT NULL,
	"effective_month" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"weekday" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fund_schedules" ADD CONSTRAINT "fund_schedules_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fund_schedules_fund_month_idx" ON "fund_schedules" USING btree ("fund_id","effective_month");