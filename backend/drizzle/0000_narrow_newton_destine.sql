CREATE TABLE IF NOT EXISTS "jobber_orgs" (
	"id" text PRIMARY KEY NOT NULL,
	"jobber_account_id" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobber_orgs_jobber_account_id_unique" UNIQUE("jobber_account_id")
);
