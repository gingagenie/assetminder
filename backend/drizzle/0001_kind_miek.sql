CREATE TABLE IF NOT EXISTS "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"jobber_client_id" text NOT NULL,
	"name" text NOT NULL,
	"company_name" text,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_org_jobber_client_unique" UNIQUE("org_id","jobber_client_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_custom_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"field_label" text NOT NULL,
	"field_value" text,
	CONSTRAINT "job_custom_fields_job_label_unique" UNIQUE("job_id","field_label")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"jobber_job_id" text NOT NULL,
	"jobber_client_id" text,
	"title" text,
	"job_number" integer,
	"job_status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "jobs_org_jobber_job_unique" UNIQUE("org_id","jobber_job_id")
);
