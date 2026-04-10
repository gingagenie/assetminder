import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { jobberOrgs, assets } from "../db/schema";

const AMBER_THRESHOLD_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type DueStatus = "ok" | "amber" | "overdue" | "unscheduled";

export interface AssetDueResult {
  id: string;
  identifier: string;
  displayName: string;
  jobberClientId: string | null;
  lastServicedAt: string | null;
  nextDueAt: string | null;
  serviceIntervalDays: number | null;
  jobCount: number;
  status: DueStatus;
}

function calcStatus(nextDueAt: Date | null, intervalDays: number | null): DueStatus {
  if (!intervalDays) return "unscheduled";
  if (!nextDueAt) return "unscheduled";

  const now = Date.now();
  const dueMs = nextDueAt.getTime();
  const daysUntilDue = (dueMs - now) / MS_PER_DAY;

  if (daysUntilDue < 0) return "overdue";
  if (daysUntilDue <= AMBER_THRESHOLD_DAYS) return "amber";
  return "ok";
}

export async function calculateDueDates(jobberAccountId: string): Promise<AssetDueResult[]> {
  const [org] = await db
    .select()
    .from(jobberOrgs)
    .where(eq(jobberOrgs.jobberAccountId, jobberAccountId))
    .limit(1);

  if (!org) throw new Error(`Org not found: ${jobberAccountId}`);

  const orgAssets = await db
    .select()
    .from(assets)
    .where(eq(assets.orgId, org.id));

  const results: AssetDueResult[] = [];

  for (const asset of orgAssets) {
    const intervalDays = asset.serviceIntervalDays ?? null;
    const lastServicedAt = asset.lastServicedAt ? new Date(asset.lastServicedAt) : null;

    let nextDueAt: Date | null = null;

    if (intervalDays && lastServicedAt) {
      nextDueAt = new Date(lastServicedAt.getTime() + intervalDays * MS_PER_DAY);

      await db
        .update(assets)
        .set({ nextDueAt })
        .where(eq(assets.id, asset.id));
    }

    results.push({
      id: asset.id,
      identifier: asset.identifier,
      displayName: asset.displayName,
      jobberClientId: asset.jobberClientId ?? null,
      lastServicedAt: lastServicedAt?.toISOString() ?? null,
      nextDueAt: nextDueAt?.toISOString() ?? null,
      serviceIntervalDays: intervalDays,
      jobCount: asset.jobCount,
      status: calcStatus(nextDueAt, intervalDays),
    });
  }

  return results;
}
