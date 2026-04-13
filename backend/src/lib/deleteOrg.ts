import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { jobberOrgs, clients, jobs, jobCustomFields, jobLineItems, assets } from "../db/schema";

/**
 * Permanently deletes all data for a Jobber org.
 * Resolves the org by jobberAccountId, deletes child records first
 * (jobCustomFields, jobLineItems) then org-scoped tables, then the org row.
 * Safe to call if the org doesn't exist (no-op).
 */
export async function deleteOrgData(jobberAccountId: string): Promise<void> {
  const [org] = await db
    .select({ id: jobberOrgs.id })
    .from(jobberOrgs)
    .where(eq(jobberOrgs.jobberAccountId, jobberAccountId))
    .limit(1);

  if (!org) {
    console.log(`[disconnect] org not found for ${jobberAccountId} — nothing to delete`);
    return;
  }

  const orgId = org.id;

  // Collect job IDs so we can delete child records that reference them
  const jobRows = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.orgId, orgId));

  const jobIds = jobRows.map((j) => j.id);

  if (jobIds.length > 0) {
    await db.delete(jobCustomFields).where(inArray(jobCustomFields.jobId, jobIds));
    await db.delete(jobLineItems).where(inArray(jobLineItems.jobId, jobIds));
  }

  await db.delete(jobs).where(eq(jobs.orgId, orgId));
  await db.delete(clients).where(eq(clients.orgId, orgId));
  await db.delete(assets).where(eq(assets.orgId, orgId));
  await db.delete(jobberOrgs).where(eq(jobberOrgs.id, orgId));

  console.log(`[disconnect] deleted all data for org ${orgId} (jobberAccountId=${jobberAccountId})`);
}
