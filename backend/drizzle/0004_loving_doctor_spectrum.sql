ALTER TABLE "assets" ADD COLUMN "service_interval_days" integer;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "next_due_at" timestamp with time zone;