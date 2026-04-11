CREATE TABLE IF NOT EXISTS "job_line_items" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"name" text NOT NULL,
	"quantity" numeric NOT NULL,
	"unit_price" numeric NOT NULL,
	"total" numeric NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "assigned_to" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "instructions" text;