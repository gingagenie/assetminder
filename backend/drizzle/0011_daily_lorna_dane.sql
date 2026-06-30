ALTER TABLE "jobber_orgs" ADD COLUMN IF NOT EXISTS "pin_hash" text;--> statement-breakpoint
ALTER TABLE "jobber_orgs" ADD COLUMN IF NOT EXISTS "pin_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobber_orgs" ADD COLUMN IF NOT EXISTS "pin_failed_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobber_orgs" ADD COLUMN IF NOT EXISTS "pin_locked_until" timestamp with time zone;
