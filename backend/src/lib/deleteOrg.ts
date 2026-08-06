import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { jobberOrgs, clients, jobs, jobCustomFields, jobLineItems, assets, orgSettings, sessions } from "../db/schema";
import { destroyAllSessions } from "./session";

/**
 * Soft-deletes a Jobber org on disconnect.
 *
 * Child data (clients, jobs, assets, etc.) is permanently deleted to honour
 * the "your data is deleted" promise. The jobber_orgs row itself is kept as a
 * tombstone — subscription_status='expired' and disconnected_at set — so that
 * reconnecting the same Jobber account never grants a fresh trial.
 *
 * Personal fields (email, password_hash, name) and credentials (tokens) are
 * nulled out on the tombstone; only jobber_account_id, trial_started_at,
 * subscription_status, and disconnected_at are preserved.
 *
 * Safe to call if the org doesn't exist (no-op).
 */
export async function deleteOrgData(jobberAccountId: string): Promise<void> {
  const [org] = await db
    .select({
      id: jobberOrgs.id,
      subscriptionStatus: jobberOrgs.subscriptionStatus,
      trialStartedAt: jobberOrgs.trialStartedAt,
      createdAt: jobberOrgs.createdAt,
    })
    .from(jobberOrgs)
    .where(eq(jobberOrgs.jobberAccountId, jobberAccountId))
    .limit(1);

  if (!org) {
    console.log(`[disconnect] org not found for ${jobberAccountId} — nothing to delete`);
    return;
  }

  const orgId = org.id;

  // Destroy all active sessions so no lingering cookie grants access.
  await destroyAllSessions(jobberAccountId);

  // Delete child records (permanent — data deletion promise honoured).
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
  await db.delete(orgSettings).where(eq(orgSettings.orgId, orgId));

  // Compute the correct tombstone status — checked in priority order:
  // 1. Paying customers (subscriptionStatus="active") keep "active": a Jobber
  //    disconnect should not cut off a paying subscriber.
  // 2. Orgs still inside their trial window keep "trial": accidental or
  //    short-lived disconnects during the trial shouldn't forfeit the remainder.
  // 3. Everything else (trial lapsed, already expired) → "expired".
  // trialStartedAt is intentionally NOT reset — this is the abuse-prevention
  // anchor that prevents a fresh trial window on reconnect.
  const trialStart = org.trialStartedAt ?? org.createdAt;
  const trialEndMs = trialStart.getTime() + 14 * 24 * 60 * 60 * 1000;
  const tombstoneStatus =
    org.subscriptionStatus === "active"
      ? "active"
      : Date.now() < trialEndMs
      ? "trial"
      : "expired";

  // Soft-delete the org row: null personal/credential fields, preserve trial anchor.
  await db
    .update(jobberOrgs)
    .set({
      name: null,
      email: null,
      passwordHash: null,
      passwordSetAt: null,
      accessToken: "",
      refreshToken: "",
      expiresAt: new Date(0),
      assetIdentifierField: null,
      assetIdentifierFieldId: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      subscriptionStatus: tombstoneStatus,
      disconnectedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(jobberOrgs.id, orgId));

  console.log(`[disconnect] soft-deleted org ${orgId} (jobberAccountId=${jobberAccountId}) — tombstone preserved`);
}
