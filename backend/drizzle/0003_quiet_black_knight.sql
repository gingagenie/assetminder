CREATE TABLE IF NOT EXISTS "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"jobber_client_id" text,
	"identifier" text NOT NULL,
	"display_name" text NOT NULL,
	"last_serviced_at" timestamp with time zone,
	"job_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_org_identifier_unique" UNIQUE("org_id","identifier")
);
