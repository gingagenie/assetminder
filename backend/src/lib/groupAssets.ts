import crypto from "crypto";
import { sql, SQL, eq } from "drizzle-orm";
import { db } from "../db/client";
import { jobberOrgs, assets, orgSettings } from "../db/schema";

interface AssetRow {
  identifier: string;
  jobber_client_id: string | null;
  job_count: string; // postgres returns bigint as string
  last_serviced_at: Date | string | null;
}

export interface AssetResult {
  identifier: string;
  displayName: string;
  jobberClientId: string | null;
  lastServicedAt: string | null;
  jobCount: number;
}

export async function groupAssets(jobberAccountId: string): Promise<AssetResult[]> {
  const [org] = await db
    .select()
    .from(jobberOrgs)
    .where(eq(jobberOrgs.jobberAccountId, jobberAccountId))
    .limit(1);

  if (!org) throw new Error(`Org not found: ${jobberAccountId}`);
  if (!org.assetIdentifierField) throw new Error(`No asset identifier field mapped for org: ${jobberAccountId}`);

  const fieldLabel = org.assetIdentifierField;
  const orgId = org.id;

  // Load service keywords for this org
  const [settings] = await db
    .select()
    .from(orgSettings)
    .where(eq(orgSettings.orgId, orgId))
    .limit(1);

  const keywords = (settings?.serviceKeywords ?? []).map((k) => k.trim()).filter(Boolean);

  // Build the service filter for last_serviced_at.
  // With keywords: only count jobs whose title matches at least one keyword.
  // Without keywords: count all jobs (fall-back, preserves existing behaviour).
  let serviceFilter: SQL;
  if (keywords.length > 0) {
    const parts = keywords.map((kw) => sql`LOWER(j.title) LIKE ${`%${kw.toLowerCase()}%`}`);
    serviceFilter = sql`(${sql.join(parts, sql` OR `)})`;
  } else {
    serviceFilter = sql`TRUE`;
  }

  // Group jobs by custom field value.
  // job_count counts ALL jobs (full service history).
  // last_serviced_at is MAX(completed_at) filtered to service jobs only (or all if no keywords).
  const raw = await db.execute(sql`
    SELECT DISTINCT ON (jcf.field_value)
      jcf.field_value                                                                           AS identifier,
      j.jobber_client_id,
      COUNT(j.id) OVER (PARTITION BY jcf.field_value)                                          AS job_count,
      MAX(CASE WHEN ${serviceFilter} THEN j.completed_at END) OVER (PARTITION BY jcf.field_value) AS last_serviced_at
    FROM job_custom_fields jcf
    JOIN jobs j ON j.id = jcf.job_id
    WHERE jcf.field_label = ${fieldLabel}
      AND j.org_id       = ${orgId}
      AND jcf.field_value IS NOT NULL
      AND jcf.field_value != ''
    ORDER BY jcf.field_value, j.completed_at DESC NULLS LAST
  `);

  const rows = raw as unknown as AssetRow[];

  if (rows.length === 0) return [];

  // Upsert each asset
  for (const row of rows) {
    const lastServicedAt = row.last_serviced_at ? new Date(row.last_serviced_at) : null;
    const jobCount = parseInt(String(row.job_count), 10);

    await db
      .insert(assets)
      .values({
        id: crypto.randomUUID(),
        orgId,
        jobberClientId: row.jobber_client_id ?? null,
        identifier: row.identifier,
        displayName: row.identifier,
        lastServicedAt,
        jobCount,
      })
      .onConflictDoUpdate({
        target: [assets.orgId, assets.identifier],
        set: {
          jobberClientId: row.jobber_client_id ?? null,
          displayName: row.identifier,
          lastServicedAt,
          jobCount,
        },
      });
  }

  return rows.map((row) => ({
    identifier: row.identifier,
    displayName: row.identifier,
    jobberClientId: row.jobber_client_id ?? null,
    lastServicedAt: row.last_serviced_at ? new Date(row.last_serviced_at).toISOString() : null,
    jobCount: parseInt(String(row.job_count), 10),
  }));
}
