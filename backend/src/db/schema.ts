import { pgTable, text, timestamp, integer, numeric, unique, boolean } from "drizzle-orm/pg-core";

export const jobberOrgs = pgTable("jobber_orgs", {
  id: text("id").primaryKey(),
  jobberAccountId: text("jobber_account_id").notNull().unique(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  assetIdentifierField: text("asset_identifier_field"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clients = pgTable("clients", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  jobberClientId: text("jobber_client_id").notNull(),
  name: text("name").notNull(),
  companyName: text("company_name"),
  email: text("email"),
  portalToken: text("portal_token").unique(),
  serviceIntervalDays: integer("service_interval_days"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("clients_org_jobber_client_unique").on(t.orgId, t.jobberClientId),
]);

export const jobs = pgTable("jobs", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  jobberJobId: text("jobber_job_id").notNull(),
  jobberClientId: text("jobber_client_id"),
  title: text("title"),
  jobNumber: integer("job_number"),
  jobStatus: text("job_status").notNull(),
  assignedTo: text("assigned_to"),
  instructions: text("instructions"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [
  unique("jobs_org_jobber_job_unique").on(t.orgId, t.jobberJobId),
]);

export const jobLineItems = pgTable("job_line_items", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  name: text("name").notNull(),
  quantity: numeric("quantity").notNull(),
  unitPrice: numeric("unit_price").notNull(),
  total: numeric("total").notNull(),
});

export const jobCustomFields = pgTable("job_custom_fields", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  fieldLabel: text("field_label").notNull(),
  fieldValue: text("field_value"),
}, (t) => [
  unique("job_custom_fields_job_label_unique").on(t.jobId, t.fieldLabel),
]);

export const assets = pgTable("assets", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  jobberClientId: text("jobber_client_id"),
  identifier: text("identifier").notNull(),
  displayName: text("display_name").notNull(),
  lastServicedAt: timestamp("last_serviced_at", { withTimezone: true }),
  jobCount: integer("job_count").notNull().default(0),
  serviceIntervalDays: integer("service_interval_days"),
  nextDueAt: timestamp("next_due_at", { withTimezone: true }),
  intervalOverridden: boolean("interval_overridden").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("assets_org_identifier_unique").on(t.orgId, t.identifier),
]);

export const orgSettings = pgTable("org_settings", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().unique(),
  serviceKeywords: text("service_keywords").array().notNull().default([]),
});

export type JobberOrg = typeof jobberOrgs.$inferSelect;
export type NewJobberOrg = typeof jobberOrgs.$inferInsert;
export type Client = typeof clients.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type JobCustomField = typeof jobCustomFields.$inferSelect;
