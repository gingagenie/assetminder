CREATE TABLE IF NOT EXISTS "org_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"service_keywords" text[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "org_settings_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "interval_overridden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "service_interval_days" integer;--> statement-breakpoint
ALTER TABLE "jobber_orgs" ADD COLUMN IF NOT EXISTS "asset_identifier_field_id" text;--> statement-breakpoint
ALTER TABLE "jobber_orgs" ADD COLUMN IF NOT EXISTS "trial_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobber_orgs" ADD COLUMN IF NOT EXISTS "subscription_status" text DEFAULT 'trial' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobber_orgs" ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "jobber_orgs" ADD COLUMN IF NOT EXISTS "stripe_subscription_id" text;
