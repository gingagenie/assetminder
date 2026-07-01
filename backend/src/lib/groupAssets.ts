import crypto from "crypto";
import { sql, SQL, eq, and } from "drizzle-orm";
import { db } from "../db/client";
import { jobberOrgs, assets, orgSettings, clients } from "../db/schema";

// ---------- Fuzzy name similarity ----------

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

function nameSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a.toLowerCase(), b.toLowerCase()) / maxLen;
}

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

  // Build a map of jobberClientId → serviceIntervalDays so new assets inherit
  // the client default without an extra per-asset query.
  const clientRows = await db
    .select({ jobberClientId: clients.jobberClientId, serviceIntervalDays: clients.serviceIntervalDays })
    .from(clients)
    .where(eq(clients.orgId, orgId));
  const clientIntervalMap = new Map(
    clientRows.map((c) => [c.jobberClientId, c.serviceIntervalDays ?? null])
  );

  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  // Snapshot existing assets BEFORE the upsert loop so we can detect new ones
  // and run a fuzzy name match against sibling assets for the same client.
  const existingAssets = await db
    .select({ id: assets.id, identifier: assets.identifier, jobberClientId: assets.jobberClientId })
    .from(assets)
    .where(eq(assets.orgId, orgId));
  const existingIdentifiers = new Set(existingAssets.map((a) => a.identifier));
  // Group by client for efficient lookup
  const assetsByClient = new Map<string | null, typeof existingAssets>();
  for (const a of existingAssets) {
    const key = a.jobberClientId;
    if (!assetsByClient.has(key)) assetsByClient.set(key, []);
    assetsByClient.get(key)!.push(a);
  }

  // Upsert each asset
  for (const row of rows) {
    const lastServicedAt = row.last_serviced_at ? new Date(row.last_serviced_at) : null;
    const jobCount = parseInt(String(row.job_count), 10);

    const clientInterval = clientIntervalMap.get(row.jobber_client_id ?? "") ?? null;
    const isNew = !existingIdentifiers.has(row.identifier);

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
        serviceIntervalDays: clientInterval,
      })
      .onConflictDoUpdate({
        target: [assets.orgId, assets.identifier],
        set: {
          jobberClientId: row.jobber_client_id ?? null,
          displayName: row.identifier,
          lastServicedAt,
          jobCount,
          // Only update interval if asset hasn't been individually overridden
          serviceIntervalDays: sql`CASE WHEN ${assets.intervalOverridden} THEN ${assets.serviceIntervalDays} ELSE ${clientInterval} END`,
        },
      });

    // For newly-detected assets, check for similar-sounding sibling assets.
    if (isNew) {
      const siblings = assetsByClient.get(row.jobber_client_id ?? null) ?? [];
      let bestId: string | null = null;
      let bestScore = 0;
      for (const sibling of siblings) {
        const score = nameSimilarity(row.identifier, sibling.identifier);
        if (score >= 0.8 && score > bestScore) {
          bestId = sibling.id;
          bestScore = score;
        }
      }
      if (bestId) {
        await db
          .update(assets)
          .set({ flaggedSimilarTo: bestId })
          .where(and(eq(assets.orgId, orgId), eq(assets.identifier, row.identifier)));
        console.log(`[groupAssets] flagged new asset "${row.identifier}" as similar to asset ${bestId} (score ${bestScore.toFixed(2)})`);
      }
    }
  }

  return rows.map((row) => ({
    identifier: row.identifier,
    displayName: row.identifier,
    jobberClientId: row.jobber_client_id ?? null,
    lastServicedAt: row.last_serviced_at ? new Date(row.last_serviced_at).toISOString() : null,
    jobCount: parseInt(String(row.job_count), 10),
  }));
}
