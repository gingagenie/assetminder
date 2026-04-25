ALTER TABLE "clients" ADD COLUMN "service_interval_days" integer;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "interval_overridden" boolean NOT NULL DEFAULT false;
