CREATE TABLE "org_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"service_keywords" text[] NOT NULL DEFAULT '{}',
	CONSTRAINT "org_settings_org_id_unique" UNIQUE("org_id")
);
