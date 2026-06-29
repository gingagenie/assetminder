CREATE TABLE IF NOT EXISTS "login_events" (
	"id" text PRIMARY KEY NOT NULL,
	"jobber_account_id" text NOT NULL,
	"event_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
