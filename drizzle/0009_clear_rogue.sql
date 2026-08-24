CREATE TABLE "notifications_sent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth_key" text NOT NULL,
	"user_agent" text,
	"expired_at" timestamp with time zone,
	"last_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_key" ON "notifications_sent" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_sent_at_idx" ON "notifications_sent" USING btree ("sent_at");