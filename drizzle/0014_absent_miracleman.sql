ALTER TABLE "transactions" ADD COLUMN "split_group_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "split_original_cents" bigint;