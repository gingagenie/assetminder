import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const jobberOrgs = pgTable("jobber_orgs", {
  id: text("id").primaryKey(),
  jobberAccountId: text("jobber_account_id").notNull().unique(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type JobberOrg = typeof jobberOrgs.$inferSelect;
export type NewJobberOrg = typeof jobberOrgs.$inferInsert;
