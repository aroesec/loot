CREATE TABLE "mileage_trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drove_on" date NOT NULL,
	"miles_tenths" integer NOT NULL,
	"purpose" text NOT NULL,
	"destination" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mileage_trips_drove_on_idx" ON "mileage_trips" USING btree ("drove_on");