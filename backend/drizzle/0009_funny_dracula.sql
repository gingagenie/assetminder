CREATE TABLE IF NOT EXISTS "excluded_photos" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"jobber_job_id" text NOT NULL,
	"filename" text NOT NULL,
	CONSTRAINT "excluded_photos_org_job_filename_unique" UNIQUE("org_id","jobber_job_id","filename")
);
