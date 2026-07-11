import { Router, Request, Response } from "express";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import crypto from "crypto";
import PDFDocument from "pdfkit";
import { getValidToken } from "../lib/jobberToken";
import { syncOrg } from "../lib/sync";
import { groupAssets } from "../lib/groupAssets";
import { calculateDueDates } from "../lib/calculateDueDates";
import { deleteOrgData } from "../lib/deleteOrg";
import stripe from "../lib/stripe";
import { db } from "../db/client";
import { jobberOrgs, assets, jobs, jobCustomFields, clients, jobLineItems, orgSettings, excludedPhotos } from "../db/schema";

const router = Router();

const JOBBER_GRAPHQL_URL = "https://api.getjobber.com/api/graphql";
const JOBBER_API_VERSION = "2025-04-16";

// ---------- helpers ----------

async function jobberGql<T>(accessToken: string, query: string, attempt = 1): Promise<T> {
  const res = await fetch(JOBBER_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-JOBBER-GRAPHQL-VERSION": JOBBER_API_VERSION,
    },
    body: JSON.stringify({ query }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Jobber HTTP ${res.status}: ${text}`);

  const json = JSON.parse(text) as { data?: T; errors?: { message: string }[] };

  if (json.errors?.length) {
    const isThrottled = json.errors.some((e) => e.message.toLowerCase().includes("throttl"));
    if (isThrottled && attempt < 4) {
      const delay = attempt * 10000;
      console.log(`[api] Throttled by Jobber, retrying in ${delay}ms (attempt ${attempt})...`);
      await new Promise((r) => setTimeout(r, delay));
      return jobberGql<T>(accessToken, query, attempt + 1);
    }
    throw new Error(json.errors.map((e) => e.message).join(", "));
  }

  return json.data as T;
}

// Jobber stores custom field instance IDs as base64("{jobNumericId}::{configNumericId}").
// Both the job GID and config GID are themselves base64-encoded (e.g. base64("gid://Jobber/Job/123")).
// We decode each GID, extract the trailing numeric segment, then re-encode the compound key.
function computeCustomFieldInstanceId(jobberJobId: string, fieldConfigId: string): string {
  const jobNumericId = Buffer.from(jobberJobId, "base64").toString("utf8").split("/").pop()!;
  const configNumericId = Buffer.from(fieldConfigId, "base64").toString("utf8").split("/").pop()!;
  return Buffer.from(`${jobNumericId}::${configNumericId}`).toString("base64");
}

// Writes a single text custom-field value back to Jobber via jobEdit.
// Uses the computed instance ID (base64("{jobNumericId}::{configNumericId}")) —
// jobEdit rejects the config GID but accepts the instance ID in the same `id` field.
// Throws on transport errors, GraphQL errors, or userErrors.
async function writeAssetIdToJobber(
  accessToken: string,
  jobberJobId: string,
  fieldConfigId: string,
  value: string,
): Promise<void> {
  const instanceId = computeCustomFieldInstanceId(jobberJobId, fieldConfigId);

  const mutation = `
    mutation {
      jobEdit(
        jobId: ${JSON.stringify(jobberJobId)}
        input: {
          customFields: [
            { id: ${JSON.stringify(instanceId)}, valueText: ${JSON.stringify(value)} }
          ]
        }
      ) {
        job { id }
        userErrors { message path }
      }
    }
  `;

  const data = await jobberGql<{ jobEdit: { userErrors: { message: string }[] } }>(accessToken, mutation);
  const errs = data.jobEdit?.userErrors ?? [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join(", "));
}

// True when Jobber rejected the write because the token lacks the write_jobs
// scope (e.g. "An object of type JobEdit was hidden due to permissions"). This
// happens for accounts connected before write_jobs was requested, until they
// reconnect. In that case we fall back to a local-only save instead of failing.
function isJobberPermissionError(err: unknown): boolean {
  return /hidden due to permissions|permission/i.test(String(err));
}

async function requireOrg(jobberAccountId: string) {
  const [org] = await db
    .select()
    .from(jobberOrgs)
    .where(eq(jobberOrgs.jobberAccountId, jobberAccountId))
    .limit(1);
  if (!org) throw new Error(`Org not found: ${jobberAccountId}`);
  return org;
}

function isDisconnectError(err: unknown): boolean {
  return String(err).includes("disconnected this app");
}

// ---------- GET /api/me ----------

router.get("/me", async (req: Request, res: Response) => {
  const jobberAccountId = req.accountId;

  if (!jobberAccountId || typeof jobberAccountId !== "string") {
    res.status(400).json({ error: "Missing required query param: jobberAccountId" });
    return;
  }

  try {
    await requireOrg(jobberAccountId);
  } catch {
    res.status(401).json({ error: "Org not found" });
    return;
  }

  try {
    const accessToken = await getValidToken(jobberAccountId);
    const data = await jobberGql<{ account: { name: string } }>(accessToken, "{ account { name } }");
    res.json({ accountName: data.account.name });
  } catch (err) {
    if (isDisconnectError(err)) {
      console.log(`[sync] 401 disconnect detected — cleaning up org data for ${jobberAccountId}`);
      await deleteOrgData(jobberAccountId);
      res.status(401).json({ error: "Org disconnected" });
      return;
    }
    res.status(500).json({ error: String(err) });
  }
});

// ---------- POST /api/sync ----------

router.post("/sync", async (req: Request, res: Response) => {
  const jobberAccountId = req.accountId;

  if (!jobberAccountId) {
    res.status(400).json({ error: "Missing required body param: jobberAccountId" });
    return;
  }

  // Respond immediately — full pipeline runs in background so the client
  // doesn't time out waiting for a potentially long sync.
  res.json({ ok: true, message: "Sync started" });

  setImmediate(async () => {
    try {
      const result = await syncOrg(jobberAccountId);
      console.log("[sync] syncOrg complete:", result);
      await groupAssets(jobberAccountId);
      console.log("[sync] groupAssets complete");
      await calculateDueDates(jobberAccountId);
      console.log("[sync] pipeline complete for", jobberAccountId);
    } catch (err) {
      console.error("[sync] pipeline error:", err);
    }
  });
});

// ---------- GET /api/custom-fields ----------

const CUSTOM_FIELD_CONFIGS_QUERY = `
  {
    customFieldConfigurations(first: 100) {
      nodes {
        ... on CustomFieldConfigurationText      { id name appliesTo }
        ... on CustomFieldConfigurationNumeric   { id name appliesTo }
        ... on CustomFieldConfigurationDropdown  { id name appliesTo }
        ... on CustomFieldConfigurationArea      { id name appliesTo }
        ... on CustomFieldConfigurationLink      { id name appliesTo }
        ... on CustomFieldConfigurationTrueFalse { id name appliesTo }
      }
    }
  }
`;

router.get("/custom-fields", async (req: Request, res: Response) => {
  const jobberAccountId = req.accountId;

  if (!jobberAccountId || typeof jobberAccountId !== "string") {
    res.status(400).json({ error: "Missing required query param: jobberAccountId" });
    return;
  }

  try {
    const accessToken = await getValidToken(jobberAccountId);
    const data = await jobberGql<{
      customFieldConfigurations: {
        nodes: { id: string; name: string; appliesTo: string }[];
      };
    }>(accessToken, CUSTOM_FIELD_CONFIGS_QUERY);

    const fields = data.customFieldConfigurations.nodes
      .filter((n) => n.appliesTo?.toUpperCase().includes("JOB"))
      .map((n) => ({ id: n.id, label: n.name }));

    res.json({ fields });
  } catch (err) {
    console.error("[custom-fields] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- POST /api/orgs/field-mapping ----------

router.post("/orgs/field-mapping", async (req: Request, res: Response) => {
  const { fieldLabel, fieldId } = req.body as {
    fieldLabel?: string;
    fieldId?: string;
  };
  const jobberAccountId = req.accountId;

  if (!jobberAccountId || !fieldLabel) {
    res.status(400).json({ error: "Missing required body params: jobberAccountId, fieldLabel" });
    return;
  }

  try {
    const org = await requireOrg(jobberAccountId);

    await db
      .update(jobberOrgs)
      .set({
        assetIdentifierField: fieldLabel,
        assetIdentifierFieldId: fieldId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(jobberOrgs.id, org.id));

    res.json({ ok: true, jobberAccountId, assetIdentifierField: fieldLabel, assetIdentifierFieldId: fieldId ?? null });
  } catch (err) {
    console.error("[field-mapping] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- GET /api/orgs/field-mapping ----------

router.get("/orgs/field-mapping", async (req: Request, res: Response) => {
  const jobberAccountId = req.accountId;

  if (!jobberAccountId || typeof jobberAccountId !== "string") {
    res.status(400).json({ error: "Missing required query param: jobberAccountId" });
    return;
  }

  try {
    const org = await requireOrg(jobberAccountId);
    res.json({
      assetIdentifierField: org.assetIdentifierField ?? null,
      assetIdentifierFieldId: org.assetIdentifierFieldId ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------- POST /api/orgs/setup-asset-field ----------
// Onboarding fallback: re-runs the auto-detect/create logic from the OAuth callback.

const CUSTOM_FIELD_CONFIGS_QUERY_API = `
  {
    customFieldConfigurations(first: 100) {
      nodes {
        ... on CustomFieldConfigurationText      { id name appliesTo }
        ... on CustomFieldConfigurationNumeric   { id name appliesTo }
        ... on CustomFieldConfigurationDropdown  { id name appliesTo }
        ... on CustomFieldConfigurationArea      { id name appliesTo }
        ... on CustomFieldConfigurationLink      { id name appliesTo }
        ... on CustomFieldConfigurationTrueFalse { id name appliesTo }
      }
    }
  }
`;

const ASSET_FIELD_NAME_RE = /serial|asset|equipment|\bid\b/i;

router.post("/orgs/setup-asset-field", async (req: Request, res: Response) => {
  const jobberAccountId = req.accountId;
  if (!jobberAccountId) {
    res.status(400).json({ error: "Missing jobberAccountId" });
    return;
  }

  try {
    const org = await requireOrg(jobberAccountId);
    const accessToken = await getValidToken(jobberAccountId);

    // 1. Fetch existing configs
    const cfRes = await fetch(JOBBER_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-JOBBER-GRAPHQL-VERSION": JOBBER_API_VERSION,
      },
      body: JSON.stringify({ query: CUSTOM_FIELD_CONFIGS_QUERY_API }),
    });
    const cfText = await cfRes.text();
    console.log(`[setup-asset-field] customFieldConfigurations response (HTTP ${cfRes.status}):`, cfText);
    if (!cfRes.ok) throw new Error(`Jobber HTTP ${cfRes.status}: ${cfText}`);

    const cfJson = JSON.parse(cfText) as {
      data?: { customFieldConfigurations: { nodes: { id: string; name: string; appliesTo: string }[] } };
      errors?: { message: string }[];
    };
    if (cfJson.errors?.length) throw new Error(cfJson.errors.map((e) => e.message).join(", "));

    const nodes = cfJson.data?.customFieldConfigurations?.nodes ?? [];
    const jobFields = nodes.filter((n) => n.appliesTo?.toUpperCase().includes("JOB"));
    console.log(`[setup-asset-field] ${jobFields.length} JOB field(s):`, jobFields.map((n) => n.name));

    // 2. Check for a matching field
    const match = jobFields.find((n) => ASSET_FIELD_NAME_RE.test(n.name));
    if (match) {
      console.log(`[setup-asset-field] Matched existing field: "${match.name}" (${match.id})`);
      await db
        .update(jobberOrgs)
        .set({ assetIdentifierField: match.name, assetIdentifierFieldId: match.id, updatedAt: new Date() })
        .where(eq(jobberOrgs.id, org.id));
      res.json({ ok: true, fieldLabel: match.name, fieldId: match.id, created: false });
      return;
    }

    // 3. No match — create "Asset ID"
    const createMutation = `
      mutation {
        customFieldConfigurationCreateText(input: {
          name: "Asset ID"
          appliesTo: ALL_JOBS
          transferable: false
          readOnly: false
        }) {
          customFieldConfiguration {
            ... on CustomFieldConfigurationText { id name }
          }
          userErrors { message }
        }
      }
    `;
    const createRes = await fetch(JOBBER_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-JOBBER-GRAPHQL-VERSION": JOBBER_API_VERSION,
      },
      body: JSON.stringify({ query: createMutation }),
    });
    const createText = await createRes.text();
    console.log(`[setup-asset-field] customFieldConfigurationCreateText response (HTTP ${createRes.status}):`, createText);
    if (!createRes.ok) throw new Error(`Jobber HTTP ${createRes.status}: ${createText}`);

    const createJson = JSON.parse(createText) as {
      data?: {
        customFieldConfigurationCreateText: {
          customFieldConfiguration: { id: string; name: string } | null;
          userErrors: { message: string }[];
        };
      };
      errors?: { message: string }[];
    };
    if (createJson.errors?.length) throw new Error(createJson.errors.map((e) => e.message).join(", "));
    const payload = createJson.data?.customFieldConfigurationCreateText;
    if (payload?.userErrors?.length) throw new Error(payload.userErrors.map((e) => e.message).join(", "));
    const created = payload?.customFieldConfiguration;
    if (!created) throw new Error(`Create returned no configuration. Full response: ${createText}`);

    console.log(`[setup-asset-field] Created field: "${created.name}" (${created.id})`);
    await db
      .update(jobberOrgs)
      .set({ assetIdentifierField: created.name, assetIdentifierFieldId: created.id, updatedAt: new Date() })
      .where(eq(jobberOrgs.id, org.id));
    res.json({ ok: true, fieldLabel: created.name, fieldId: created.id, created: true });
  } catch (err) {
    console.error("[setup-asset-field] error:", String(err));
    res.status(500).json({ error: String(err) });
  }
});

// ---------- POST /api/assets/from-jobs ----------
// Creates a new asset and links the given jobs to it via the asset identifier custom field.

router.post("/assets/from-jobs", async (req: Request, res: Response) => {
  const { clientId, displayName, jobberJobIds } = req.body as {
    clientId?: string;
    displayName?: string;
    jobberJobIds?: string[];
  };
  const jobberAccountId = req.accountId;

  if (!jobberAccountId || !displayName || !Array.isArray(jobberJobIds) || jobberJobIds.length === 0) {
    res.status(400).json({ error: "jobberAccountId, displayName, and jobberJobIds[] required" });
    return;
  }

  try {
    const org = await requireOrg(jobberAccountId);
    const fieldLabel = org.assetIdentifierField;
    if (!fieldLabel) {
      res.status(400).json({ error: "No asset identifier field mapped for this org" });
      return;
    }

    // Reject duplicate identifier within this org
    const [existing] = await db
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.orgId, org.id), eq(assets.identifier, displayName)))
      .limit(1);

    if (existing) {
      res.status(409).json({ error: `An asset named "${displayName}" already exists` });
      return;
    }

    // Verify jobs belong to this org (by jobberJobId)
    const jobRows = await db
      .select({ id: jobs.id, jobberJobId: jobs.jobberJobId })
      .from(jobs)
      .where(and(eq(jobs.orgId, org.id), inArray(jobs.jobberJobId, jobberJobIds)));

    if (jobRows.length === 0) {
      res.status(400).json({ error: "No valid jobs found for this org" });
      return;
    }

    // Write the Asset ID back to Jobber FIRST; only persist locally if every
    // write succeeds, so we never leave a local-only value that a later resync
    // would clobber. Skipped only if no custom-field config ID is mapped.
    if (org.assetIdentifierFieldId) {
      const token = await getValidToken(jobberAccountId);
      try {
        for (const job of jobRows) {
          await writeAssetIdToJobber(token, job.jobberJobId, org.assetIdentifierFieldId, displayName);
        }
      } catch (err) {
        if (isJobberPermissionError(err)) {
          // Token lacks write_jobs (account connected before the scope was added).
          // Save locally so creation still works; write-back resumes after reconnect.
          console.warn("[assets/from-jobs] Jobber write-back skipped (missing write_jobs scope):", String(err));
        } else {
          console.error("[assets/from-jobs] Jobber write-back failed:", String(err));
          res.status(502).json({ error: "Couldn't save the Asset ID to Jobber — please try again. No changes were made." });
          return;
        }
      }
    }

    // Create the asset
    const assetId = crypto.randomUUID();
    await db.insert(assets).values({
      id: assetId,
      orgId: org.id,
      jobberClientId: clientId ?? null,
      identifier: displayName,
      displayName,
      jobCount: jobRows.length,
    });

    // Write custom field entries so existing queries and groupAssets pick them up
    for (const job of jobRows) {
      await db
        .insert(jobCustomFields)
        .values({ id: crypto.randomUUID(), jobId: job.id, fieldLabel, fieldValue: displayName })
        .onConflictDoUpdate({
          target: [jobCustomFields.jobId, jobCustomFields.fieldLabel],
          set: { fieldValue: displayName },
        });
    }

    const [created] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);

    res.status(201).json({
      asset: {
        id: created.id,
        identifier: created.identifier,
        displayName: created.displayName,
        jobberClientId: created.jobberClientId,
        jobCount: created.jobCount,
      },
    });
  } catch (err) {
    console.error("[assets/from-jobs] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- POST /api/assets/:assetId/interval ----------

router.post("/assets/:assetId/interval", async (req: Request, res: Response) => {
  const { assetId } = req.params;
  const { intervalDays } = req.body as { intervalDays?: number };
  const jobberAccountId = req.accountId;

  if (!jobberAccountId) {
    res.status(400).json({ error: "Missing required body param: jobberAccountId" });
    return;
  }

  if (!intervalDays || typeof intervalDays !== "number" || intervalDays < 1) {
    res.status(400).json({ error: "intervalDays must be a positive integer" });
    return;
  }

  try {
    const org = await requireOrg(jobberAccountId);

    const [updated] = await db
      .update(assets)
      .set({ serviceIntervalDays: Math.round(intervalDays), intervalOverridden: true })
      .where(and(eq(assets.id, String(assetId)), eq(assets.orgId, org.id)))
      .returning({ id: assets.id, identifier: assets.identifier });

    if (!updated) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }

    res.json({ ok: true, assetId: updated.id, identifier: updated.identifier, serviceIntervalDays: Math.round(intervalDays) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------- DELETE /api/assets/:assetId ----------

router.delete("/assets/:assetId", async (req: Request, res: Response) => {
  const assetId = String(req.params.assetId);
  const jobberAccountId = req.accountId;

  if (!jobberAccountId) { res.status(400).json({ error: "Missing jobberAccountId" }); return; }

  try {
    const [org] = await db
      .select({ id: jobberOrgs.id, assetIdentifierField: jobberOrgs.assetIdentifierField, assetIdentifierFieldId: jobberOrgs.assetIdentifierFieldId })
      .from(jobberOrgs).where(eq(jobberOrgs.jobberAccountId, jobberAccountId)).limit(1);
    if (!org) { res.status(404).json({ error: "Org not found" }); return; }

    const [asset] = await db.select({ id: assets.id, identifier: assets.identifier })
      .from(assets).where(and(eq(assets.id, assetId), eq(assets.orgId, org.id))).limit(1);
    if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }

    // Clear the custom field in Jobber BEFORE removing local records so the
    // next sync doesn't see a populated field value and recreate the asset.
    if (org.assetIdentifierField && org.assetIdentifierFieldId) {
      const linkedJobs = await db
        .select({ jobberJobId: jobs.jobberJobId })
        .from(jobCustomFields)
        .innerJoin(jobs, eq(jobCustomFields.jobId, jobs.id))
        .where(
          and(
            eq(jobs.orgId, org.id),
            eq(jobCustomFields.fieldLabel, org.assetIdentifierField),
            eq(jobCustomFields.fieldValue, asset.identifier)
          )
        );

      if (linkedJobs.length > 0) {
        const token = await getValidToken(jobberAccountId);
        try {
          for (const job of linkedJobs) {
            await writeAssetIdToJobber(token, job.jobberJobId, org.assetIdentifierFieldId, "");
          }
          console.log(`[assets/delete] cleared Jobber field on ${linkedJobs.length} job(s) for asset "${asset.identifier}"`);
        } catch (err) {
          if (isJobberPermissionError(err)) {
            console.warn("[assets/delete] Jobber field clear skipped (missing write_jobs scope):", String(err));
          } else {
            throw err;
          }
        }
      }
    }

    // Unlink all jobs from this asset by deleting their custom field entries
    if (org.assetIdentifierField) {
      const orgJobIds = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.orgId, org.id));
      if (orgJobIds.length > 0) {
        await db.delete(jobCustomFields).where(
          and(
            inArray(jobCustomFields.jobId, orgJobIds.map((j) => j.id)),
            eq(jobCustomFields.fieldLabel, org.assetIdentifierField),
            eq(jobCustomFields.fieldValue, asset.identifier)
          )
        );
      }
    }

    // Clear any other assets that were flagged as similar to this one
    await db.update(assets).set({ flaggedSimilarTo: null }).where(eq(assets.flaggedSimilarTo, assetId));

    await db.delete(assets).where(and(eq(assets.id, assetId), eq(assets.orgId, org.id)));

    console.log(`[assets/delete] deleted asset ${assetId} (identifier="${asset.identifier}")`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[assets/delete] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- POST /api/assets/:assetId/rename ----------

router.post("/assets/:assetId/rename", async (req: Request, res: Response) => {
  const assetId = String(req.params.assetId);
  const { displayName } = req.body as { displayName?: string };
  const jobberAccountId = req.accountId;

  if (!jobberAccountId) { res.status(400).json({ error: "Missing jobberAccountId" }); return; }
  if (!displayName?.trim()) { res.status(400).json({ error: "displayName is required" }); return; }

  const newName = displayName.trim();

  try {
    const [org] = await db
      .select({ id: jobberOrgs.id, assetIdentifierField: jobberOrgs.assetIdentifierField, assetIdentifierFieldId: jobberOrgs.assetIdentifierFieldId })
      .from(jobberOrgs).where(eq(jobberOrgs.jobberAccountId, jobberAccountId)).limit(1);
    if (!org) { res.status(404).json({ error: "Org not found" }); return; }

    const [asset] = await db
      .select({ identifier: assets.identifier })
      .from(assets).where(and(eq(assets.id, assetId), eq(assets.orgId, org.id))).limit(1);
    if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }

    const oldIdentifier = asset.identifier;

    // Find all jobs linked to the old identifier BEFORE any local change.
    const linkedJobs = org.assetIdentifierField
      ? await db
          .select({ jobberJobId: jobs.jobberJobId, cfId: jobCustomFields.id })
          .from(jobCustomFields)
          .innerJoin(jobs, eq(jobCustomFields.jobId, jobs.id))
          .where(
            and(
              eq(jobs.orgId, org.id),
              eq(jobCustomFields.fieldLabel, org.assetIdentifierField),
              eq(jobCustomFields.fieldValue, oldIdentifier)
            )
          )
      : [];

    // Push the new value to Jobber FIRST (delete-flow pattern): a failed write
    // aborts before we touch our DB, so a resync can't clobber and retry is safe.
    if (org.assetIdentifierFieldId && linkedJobs.length > 0) {
      const token = await getValidToken(jobberAccountId);
      try {
        for (const job of linkedJobs) {
          await writeAssetIdToJobber(token, job.jobberJobId, org.assetIdentifierFieldId, newName);
        }
        console.log(`[assets/rename] pushed "${oldIdentifier}" → "${newName}" to ${linkedJobs.length} Jobber job(s)`);
      } catch (err) {
        if (isJobberPermissionError(err)) {
          console.warn("[assets/rename] Jobber write-back skipped (missing write_jobs scope):", String(err));
        } else {
          throw err;
        }
      }
    }

    // Jobber is consistent (or intentionally skipped) — now update locally.
    await db
      .update(assets)
      .set({ displayName: newName, identifier: newName })
      .where(and(eq(assets.id, assetId), eq(assets.orgId, org.id)));

    if (linkedJobs.length > 0) {
      await db
        .update(jobCustomFields)
        .set({ fieldValue: newName })
        .where(inArray(jobCustomFields.id, linkedJobs.map((j) => j.cfId)));
    }

    res.json({ ok: true, displayName: newName });
  } catch (err) {
    console.error("[assets/rename] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- POST /api/assets/:assetId/merge ----------

router.post("/assets/:assetId/merge", async (req: Request, res: Response) => {
  const assetId = String(req.params.assetId);
  const { targetAssetId } = req.body as { targetAssetId?: string };
  const jobberAccountId = req.accountId;

  if (!jobberAccountId) { res.status(400).json({ error: "Missing jobberAccountId" }); return; }

  try {
    const [org] = await db.select({ id: jobberOrgs.id, assetIdentifierField: jobberOrgs.assetIdentifierField, assetIdentifierFieldId: jobberOrgs.assetIdentifierFieldId })
      .from(jobberOrgs).where(eq(jobberOrgs.jobberAccountId, jobberAccountId)).limit(1);
    if (!org) { res.status(404).json({ error: "Org not found" }); return; }

    const [asset] = await db.select()
      .from(assets).where(and(eq(assets.id, assetId), eq(assets.orgId, org.id))).limit(1);
    if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }
    const resolvedTargetId = targetAssetId ?? asset.flaggedSimilarTo;
    if (!resolvedTargetId) { res.status(400).json({ error: "No target asset specified" }); return; }
    if (resolvedTargetId === assetId) { res.status(400).json({ error: "Cannot merge an asset into itself" }); return; }

    const [target] = await db.select()
      .from(assets).where(and(eq(assets.id, resolvedTargetId), eq(assets.orgId, org.id))).limit(1);
    if (!target) { res.status(404).json({ error: "Target asset not found" }); return; }

    if (!org.assetIdentifierField) { res.status(400).json({ error: "No asset identifier field mapped" }); return; }

    // Find all jobs linked to the losing asset's identifier BEFORE any local
    // change, so we can push the surviving name to Jobber first (delete-flow
    // pattern). All-or-nothing: a hard write error throws before we touch our
    // DB, leaving it fully pre-merge so a resync won't clobber and retry is safe.
    const linkedJobs = await db
      .select({ jobberJobId: jobs.jobberJobId })
      .from(jobCustomFields)
      .innerJoin(jobs, eq(jobCustomFields.jobId, jobs.id))
      .where(
        and(
          eq(jobs.orgId, org.id),
          eq(jobCustomFields.fieldLabel, org.assetIdentifierField),
          eq(jobCustomFields.fieldValue, asset.identifier)
        )
      );

    if (org.assetIdentifierFieldId && linkedJobs.length > 0) {
      const token = await getValidToken(jobberAccountId);
      try {
        for (const job of linkedJobs) {
          await writeAssetIdToJobber(token, job.jobberJobId, org.assetIdentifierFieldId, target.identifier);
        }
        console.log(`[assets/merge] pushed "${asset.identifier}" → "${target.identifier}" to ${linkedJobs.length} Jobber job(s)`);
      } catch (err) {
        if (isJobberPermissionError(err)) {
          console.warn("[assets/merge] Jobber write-back skipped (missing write_jobs scope):", String(err));
        } else {
          throw err;
        }
      }
    }

    // Jobber is consistent (or intentionally skipped) — now re-point locally.
    const orgJobIds = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.orgId, org.id));
    if (orgJobIds.length > 0) {
      await db.update(jobCustomFields)
        .set({ fieldValue: target.identifier })
        .where(
          and(
            inArray(jobCustomFields.jobId, orgJobIds.map((j) => j.id)),
            eq(jobCustomFields.fieldLabel, org.assetIdentifierField),
            eq(jobCustomFields.fieldValue, asset.identifier)
          )
        );
    }

    // Re-compute derived data for the org then remove the absorbed asset
    await groupAssets(jobberAccountId);
    await calculateDueDates(jobberAccountId);
    await db.delete(assets).where(and(eq(assets.id, assetId), eq(assets.orgId, org.id)));

    console.log(`[assets/merge] merged asset ${assetId} ("${asset.identifier}") into ${target.id} ("${target.identifier}")`);
    res.json({ ok: true, mergedIntoId: target.id });
  } catch (err) {
    console.error("[assets/merge] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- POST /api/assets/:assetId/dismiss-flag ----------

router.post("/assets/:assetId/dismiss-flag", async (req: Request, res: Response) => {
  const assetId = String(req.params.assetId);
  const jobberAccountId = req.accountId;

  if (!jobberAccountId) { res.status(400).json({ error: "Missing jobberAccountId" }); return; }

  try {
    const [org] = await db.select({ id: jobberOrgs.id })
      .from(jobberOrgs).where(eq(jobberOrgs.jobberAccountId, jobberAccountId)).limit(1);
    if (!org) { res.status(404).json({ error: "Org not found" }); return; }

    await db.update(assets)
      .set({ flagDismissed: true })
      .where(and(eq(assets.id, assetId), eq(assets.orgId, org.id)));

    res.json({ ok: true });
  } catch (err) {
    console.error("[assets/dismiss-flag] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- POST /api/assets/:assetId/add-jobs ----------
// Links additional jobs to an existing asset via the asset identifier custom field.

router.post("/assets/:assetId/add-jobs", async (req: Request, res: Response) => {
  const assetId = String(req.params.assetId);
  const { jobberJobIds } = req.body as {
    jobberJobIds?: string[];
  };
  const jobberAccountId = req.accountId;

  if (!jobberAccountId || !Array.isArray(jobberJobIds) || jobberJobIds.length === 0) {
    res.status(400).json({ error: "jobberAccountId and jobberJobIds[] required" });
    return;
  }

  try {
    const org = await requireOrg(jobberAccountId);
    const fieldLabel = org.assetIdentifierField;
    if (!fieldLabel) {
      res.status(400).json({ error: "No asset identifier field mapped for this org" });
      return;
    }

    // Load asset and verify org ownership
    const [asset] = await db
      .select()
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.orgId, org.id)))
      .limit(1);

    if (!asset) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }

    // Verify jobs belong to this org
    const jobRows = await db
      .select({ id: jobs.id, jobberJobId: jobs.jobberJobId })
      .from(jobs)
      .where(and(eq(jobs.orgId, org.id), inArray(jobs.jobberJobId, jobberJobIds)));

    if (jobRows.length === 0) {
      res.status(400).json({ error: "No valid jobs found for this org" });
      return;
    }

    // Write the Asset ID back to Jobber FIRST; only persist locally if every
    // write succeeds, so we never leave a local-only value that a later resync
    // would clobber. Skipped only if no custom-field config ID is mapped.
    if (org.assetIdentifierFieldId) {
      const token = await getValidToken(jobberAccountId);
      try {
        for (const job of jobRows) {
          await writeAssetIdToJobber(token, job.jobberJobId, org.assetIdentifierFieldId, asset.identifier);
        }
      } catch (err) {
        if (isJobberPermissionError(err)) {
          // Token lacks write_jobs (account connected before the scope was added).
          // Save locally so adding jobs still works; write-back resumes after reconnect.
          console.warn("[assets/add-jobs] Jobber write-back skipped (missing write_jobs scope):", String(err));
        } else {
          console.error("[assets/add-jobs] Jobber write-back failed:", String(err));
          res.status(502).json({ error: "Couldn't save the Asset ID to Jobber — please try again. No changes were made." });
          return;
        }
      }
    }

    // Write custom field entries for each job
    for (const job of jobRows) {
      await db
        .insert(jobCustomFields)
        .values({ id: crypto.randomUUID(), jobId: job.id, fieldLabel, fieldValue: asset.identifier })
        .onConflictDoUpdate({
          target: [jobCustomFields.jobId, jobCustomFields.fieldLabel],
          set: { fieldValue: asset.identifier },
        });
    }

    // Recount all jobs now linked to this asset
    const [countRow] = await db.execute(sql`
      SELECT COUNT(j.id) AS job_count
      FROM jobs j
      INNER JOIN job_custom_fields jcf ON jcf.job_id = j.id
      WHERE jcf.field_label  = ${fieldLabel}
        AND jcf.field_value  = ${asset.identifier}
        AND j.org_id         = ${org.id}
    `) as unknown as [{ job_count: string }];

    const newJobCount = parseInt(String(countRow.job_count), 10);

    await db
      .update(assets)
      .set({ jobCount: newJobCount })
      .where(eq(assets.id, assetId));

    res.json({
      asset: {
        id: asset.id,
        identifier: asset.identifier,
        displayName: asset.displayName,
        jobberClientId: asset.jobberClientId,
        jobCount: newJobCount,
      },
    });
  } catch (err) {
    console.error("[assets/add-jobs] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- POST /api/calculate-due-dates ----------

router.post("/calculate-due-dates", async (req: Request, res: Response) => {
  const jobberAccountId = req.accountId;

  if (!jobberAccountId) {
    res.status(400).json({ error: "Missing required body param: jobberAccountId" });
    return;
  }

  try {
    const result = await calculateDueDates(jobberAccountId);
    res.json({ assets: result });
  } catch (err) {
    console.error("[calculate-due-dates] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- POST /api/group-assets ----------

router.post("/group-assets", async (req: Request, res: Response) => {
  const jobberAccountId = req.accountId;

  if (!jobberAccountId) {
    res.status(400).json({ error: "Missing required body param: jobberAccountId" });
    return;
  }

  try {
    const result = await groupAssets(jobberAccountId);
    res.json({ assets: result });
  } catch (err) {
    console.error("[group-assets] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- GET /api/assets/:assetId/jobs ----------

router.get("/assets/:assetId/jobs", async (req: Request, res: Response) => {
  const assetId = String(req.params.assetId);

  try {
    // Load asset + org
    const [asset] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
    if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }

    const [org] = await db.select().from(jobberOrgs).where(eq(jobberOrgs.id, asset.orgId)).limit(1);
    if (!org) { res.status(404).json({ error: "Org not found" }); return; }

    const fieldLabel = org.assetIdentifierField;
    if (!fieldLabel) { res.status(400).json({ error: "No asset identifier field mapped" }); return; }

    // Client name
    let clientName: string | null = null;
    if (asset.jobberClientId) {
      const [client] = await db
        .select({ name: clients.name, companyName: clients.companyName })
        .from(clients)
        .where(and(eq(clients.orgId, asset.orgId), eq(clients.jobberClientId, asset.jobberClientId)))
        .limit(1);
      clientName = client?.companyName ?? client?.name ?? null;
    }

    // Similar asset flag
    let similarAsset: { id: string; displayName: string } | null = null;
    if (asset.flaggedSimilarTo && !asset.flagDismissed) {
      const [sim] = await db
        .select({ id: assets.id, displayName: assets.displayName })
        .from(assets)
        .where(eq(assets.id, asset.flaggedSimilarTo))
        .limit(1);
      similarAsset = sim ?? null;
    }

    // Jobs linked to this asset via the identifier custom field
    const jobRows = await db
      .select({
        id: jobs.id,
        jobberJobId: jobs.jobberJobId,
        jobNumber: jobs.jobNumber,
        title: jobs.title,
        completedAt: jobs.completedAt,
        jobStatus: jobs.jobStatus,
        assignedTo: jobs.assignedTo,
        instructions: jobs.instructions,
      })
      .from(jobs)
      .innerJoin(
        jobCustomFields,
        and(
          eq(jobCustomFields.jobId, jobs.id),
          eq(jobCustomFields.fieldLabel, fieldLabel),
          eq(jobCustomFields.fieldValue, asset.identifier)
        )
      )
      .where(eq(jobs.orgId, asset.orgId))
      .orderBy(desc(jobs.completedAt));

    // All custom fields for those jobs
    const jobIds = jobRows.map((j) => j.id);
    const allFields =
      jobIds.length > 0
        ? await db.select().from(jobCustomFields).where(inArray(jobCustomFields.jobId, jobIds))
        : [];

    const fieldsByJob = new Map<string, { label: string; value: string | null }[]>();
    for (const f of allFields) {
      if (!fieldsByJob.has(f.jobId)) fieldsByJob.set(f.jobId, []);
      fieldsByJob.get(f.jobId)!.push({ label: f.fieldLabel, value: f.fieldValue });
    }

    const allLineItems = jobIds.length > 0
      ? await db.select().from(jobLineItems).where(inArray(jobLineItems.jobId, jobIds))
      : [];
    const lineItemsByJob = new Map<string, typeof allLineItems>();
    for (const li of allLineItems) {
      if (!lineItemsByJob.has(li.jobId)) lineItemsByJob.set(li.jobId, []);
      lineItemsByJob.get(li.jobId)!.push(li);
    }

    // Status
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const AMBER_DAYS = 30;
    const nextDueAt = asset.nextDueAt ? new Date(asset.nextDueAt) : null;
    const intervalDays = asset.serviceIntervalDays ?? null;
    let status: "ok" | "amber" | "overdue" | "unscheduled" = "unscheduled";
    if (intervalDays && nextDueAt) {
      const days = (nextDueAt.getTime() - Date.now()) / MS_PER_DAY;
      if (days < 0) status = "overdue";
      else if (days <= AMBER_DAYS) status = "amber";
      else status = "ok";
    }

    res.json({
      asset: {
        id: asset.id,
        identifier: asset.identifier,
        displayName: asset.displayName,
        jobberClientId: asset.jobberClientId,
        clientName,
        lastServicedAt: asset.lastServicedAt ?? null,
        nextDueAt: nextDueAt?.toISOString() ?? null,
        serviceIntervalDays: intervalDays,
        jobCount: asset.jobCount,
        status,
        similarAssetId: similarAsset?.id ?? null,
        similarAssetName: similarAsset?.displayName ?? null,
      },
      jobs: jobRows.map((j) => ({
        id: j.id,
        jobberJobId: j.jobberJobId,
        jobNumber: j.jobNumber,
        title: j.title,
        completedAt: j.completedAt ?? null,
        jobStatus: j.jobStatus,
        customFields: fieldsByJob.get(j.id) ?? [],
        lineItems: (lineItemsByJob.get(j.id) ?? []).map((li) => ({
          name: li.name,
          quantity: parseFloat(li.quantity),
          unitPrice: parseFloat(li.unitPrice),
          total: parseFloat(li.total),
        })),
        technicianName: j.assignedTo ?? null,
        instructions: j.instructions ?? null,
      })),
    });
  } catch (err) {
    console.error("[asset-jobs] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- GET /api/assets ----------

router.get("/assets", async (req: Request, res: Response) => {
  const { clientId } = req.query;
  const jobberAccountId = req.accountId;

  if (!jobberAccountId || typeof jobberAccountId !== "string") {
    res.status(400).json({ error: "Missing required query param: jobberAccountId" });
    return;
  }

  try {
    const org = await requireOrg(jobberAccountId);

    // clientId may be the internal UUID — resolve to jobberClientId via the clients table
    let jobberClientIdFilter: string | null = null;
    if (clientId && typeof clientId === "string") {
      const [clientRow] = await db
        .select({ jobberClientId: clients.jobberClientId })
        .from(clients)
        .where(and(eq(clients.id, clientId), eq(clients.orgId, org.id)))
        .limit(1);
      jobberClientIdFilter = clientRow?.jobberClientId ?? clientId;
    }

    const rows = await db
      .select()
      .from(assets)
      .where(
        jobberClientIdFilter
          ? and(eq(assets.orgId, org.id), eq(assets.jobberClientId, jobberClientIdFilter))
          : eq(assets.orgId, org.id)
      );

    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const AMBER_DAYS = 30;

    res.json({
      assets: rows.map((a) => {
        const nextDueAt = a.nextDueAt ? new Date(a.nextDueAt) : null;
        const intervalDays = a.serviceIntervalDays ?? null;

        let status: "ok" | "amber" | "overdue" | "unscheduled" = "unscheduled";
        if (intervalDays && nextDueAt) {
          const daysUntilDue = (nextDueAt.getTime() - Date.now()) / MS_PER_DAY;
          if (daysUntilDue < 0) status = "overdue";
          else if (daysUntilDue <= AMBER_DAYS) status = "amber";
          else status = "ok";
        }

        return {
          id: a.id,
          identifier: a.identifier,
          displayName: a.displayName,
          jobberClientId: a.jobberClientId,
          lastServicedAt: a.lastServicedAt ?? null,
          nextDueAt: nextDueAt?.toISOString() ?? null,
          serviceIntervalDays: intervalDays,
          jobCount: a.jobCount,
          status,
        };
      }),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------- GET /api/clients ----------

router.get("/clients", async (req: Request, res: Response) => {
  const jobberAccountId = req.accountId;

  if (!jobberAccountId || typeof jobberAccountId !== "string") {
    res.status(400).json({ error: "Missing required query param: jobberAccountId" });
    return;
  }

  try {
    const org = await requireOrg(jobberAccountId);
    const rows = await db
      .select({ id: clients.id, name: clients.name, companyName: clients.companyName, email: clients.email, jobberClientId: clients.jobberClientId, portalToken: clients.portalToken, serviceIntervalDays: clients.serviceIntervalDays })
      .from(clients)
      .where(eq(clients.orgId, org.id));

    res.json({ clients: rows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------- POST /api/clients/:clientId/interval ----------

router.post("/clients/:clientId/interval", async (req: Request, res: Response) => {
  const clientId = String(req.params.clientId);
  const { intervalDays } = req.body as { intervalDays?: number | null };
  const jobberAccountId = req.accountId;

  if (!jobberAccountId) {
    res.status(400).json({ error: "Missing required body param: jobberAccountId" });
    return;
  }
  if (intervalDays !== null && intervalDays !== undefined && (typeof intervalDays !== "number" || intervalDays < 1)) {
    res.status(400).json({ error: "intervalDays must be a positive integer or null" });
    return;
  }

  try {
    const org = await requireOrg(jobberAccountId);

    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.orgId, org.id)))
      .limit(1);

    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }

    // Save interval to client
    const days = intervalDays ?? null;
    await db
      .update(clients)
      .set({ serviceIntervalDays: days })
      .where(eq(clients.id, clientId));

    // Apply to all non-overridden assets for this client
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const clientAssets = await db
      .select()
      .from(assets)
      .where(and(
        eq(assets.orgId, org.id),
        eq(assets.jobberClientId, client.jobberClientId),
        eq(assets.intervalOverridden, false),
      ));

    for (const asset of clientAssets) {
      let nextDueAt: Date | null = null;
      if (days && asset.lastServicedAt) {
        nextDueAt = new Date(new Date(asset.lastServicedAt).getTime() + days * MS_PER_DAY);
      }
      await db
        .update(assets)
        .set({ serviceIntervalDays: days, nextDueAt })
        .where(eq(assets.id, asset.id));
    }

    res.json({ ok: true, applied: clientAssets.length });
  } catch (err) {
    console.error("[client-interval] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- GET /api/clients/:clientId/unassigned-jobs ----------

router.get("/clients/:clientId/unassigned-jobs", async (req: Request, res: Response) => {
  const clientId = String(req.params.clientId);
  const jobberAccountId = req.accountId;

  if (!jobberAccountId || typeof jobberAccountId !== "string") {
    res.status(400).json({ error: "Missing required query param: jobberAccountId" });
    return;
  }

  try {
    const org = await requireOrg(jobberAccountId);
    const fieldLabel = org.assetIdentifierField;
    if (!fieldLabel) {
      res.status(400).json({ error: "No asset identifier field mapped" });
      return;
    }

    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.orgId, org.id)))
      .limit(1);
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }

    // Jobs for this client where the Asset ID field is absent or null/empty
    const allJobs = await db
      .select({
        id: jobs.id,
        jobberJobId: jobs.jobberJobId,
        jobNumber: jobs.jobNumber,
        title: jobs.title,
        jobStatus: jobs.jobStatus,
        completedAt: jobs.completedAt,
      })
      .from(jobs)
      .where(and(eq(jobs.orgId, org.id), eq(jobs.jobberClientId, client.jobberClientId)));

    if (allJobs.length === 0) {
      res.json({ jobs: [], fieldLabel });
      return;
    }

    const jobIds = allJobs.map((j) => j.id);
    const assetFields = await db
      .select({ jobId: jobCustomFields.jobId, fieldValue: jobCustomFields.fieldValue })
      .from(jobCustomFields)
      .where(and(inArray(jobCustomFields.jobId, jobIds), eq(jobCustomFields.fieldLabel, fieldLabel)));

    const assignedJobIds = new Set(
      assetFields.filter((f) => f.fieldValue && f.fieldValue.trim() !== "").map((f) => f.jobId)
    );

    const unassigned = allJobs.filter((j) => !assignedJobIds.has(j.id));

    res.json({ jobs: unassigned, fieldLabel });
  } catch (err) {
    console.error("[unassigned-jobs] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- POST /api/jobs/:jobId/set-asset-id ----------

router.post("/jobs/:jobId/set-asset-id", async (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);
  const { assetIdentifier } = req.body as {
    assetIdentifier?: string;
  };
  const jobberAccountId = req.accountId;

  if (!jobberAccountId || !assetIdentifier?.trim()) {
    res.status(400).json({ error: "Missing jobberAccountId or assetIdentifier" });
    return;
  }

  const value = assetIdentifier.trim();

  try {
    const org = await requireOrg(jobberAccountId);
    const fieldLabel = org.assetIdentifierField;
    if (!fieldLabel) {
      res.status(400).json({ error: "No asset identifier field mapped" });
      return;
    }

    const [job] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.orgId, org.id)))
      .limit(1);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const accessToken = await getValidToken(jobberAccountId);

    // Push the value to Jobber if we have the config ID; fall back to local-only if missing scope
    if (org.assetIdentifierFieldId) {
      try {
        await writeAssetIdToJobber(accessToken, job.jobberJobId, org.assetIdentifierFieldId, value);
      } catch (err) {
        if (isJobberPermissionError(err)) {
          console.warn("[set-asset-id] Jobber write-back skipped (missing write_jobs scope):", String(err));
        } else {
          console.error("[set-asset-id] Jobber write-back failed:", String(err));
          res.status(502).json({ error: "Couldn't save the Asset ID to Jobber — please try again." });
          return;
        }
      }
    }

    // Update local DB
    await db
      .insert(jobCustomFields)
      .values({ id: crypto.randomUUID(), jobId, fieldLabel, fieldValue: value })
      .onConflictDoUpdate({
        target: [jobCustomFields.jobId, jobCustomFields.fieldLabel],
        set: { fieldValue: value },
      });

    // Re-group and recalculate synchronously so the caller can immediately reload assets
    await groupAssets(jobberAccountId);
    await calculateDueDates(jobberAccountId);

    res.json({ ok: true, assetIdentifier: value });
  } catch (err) {
    console.error("[set-asset-id] error:", err);
    if (isDisconnectError(err)) {
      res.status(401).json({ error: "Org disconnected" });
      return;
    }
    res.status(500).json({ error: String(err) });
  }
});

// ---------- POST /api/clients/:clientId/portal-link ----------

router.post("/clients/:clientId/portal-link", async (req: Request, res: Response) => {
  const clientId = String(req.params.clientId);
  const jobberAccountId = req.accountId;
  const frontendBase = process.env.FRONTEND_URL ?? "http://localhost:3000";

  if (!jobberAccountId) {
    res.status(400).json({ error: "Missing required body param: jobberAccountId" });
    return;
  }

  try {
    const org = await requireOrg(jobberAccountId);

    const [existing] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.orgId, org.id)))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Client not found" }); return; }

    const token = crypto.randomUUID();

    await db.update(clients).set({ portalToken: token }).where(eq(clients.id, clientId));

    res.json({ portalUrl: `${frontendBase}/#/portal/${token}` });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------- GET /api/portal/:token ----------

router.get("/portal/:token", async (req: Request, res: Response) => {
  const token = String(req.params.token);

  try {
    const [client] = await db
      .select()
      .from(clients)
      .where(eq(clients.portalToken, token))
      .limit(1);

    if (!client) { res.status(404).json({ error: "Portal not found" }); return; }

    const orgAssets = await db
      .select()
      .from(assets)
      .where(and(eq(assets.orgId, client.orgId), eq(assets.jobberClientId, client.jobberClientId)));

    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const AMBER_DAYS = 30;

    res.json({
      client: {
        name: client.companyName ?? client.name,
        email: client.email,
      },
      assets: orgAssets.map((a) => {
        const nextDueAt = a.nextDueAt ? new Date(a.nextDueAt) : null;
        const intervalDays = a.serviceIntervalDays ?? null;
        let status: "ok" | "amber" | "overdue" | "unscheduled" = "unscheduled";
        if (intervalDays && nextDueAt) {
          const days = (nextDueAt.getTime() - Date.now()) / MS_PER_DAY;
          if (days < 0) status = "overdue";
          else if (days <= AMBER_DAYS) status = "amber";
          else status = "ok";
        }
        return {
          id: a.id,
          identifier: a.identifier,
          displayName: a.displayName,
          lastServicedAt: a.lastServicedAt ?? null,
          nextDueAt: nextDueAt?.toISOString() ?? null,
          jobCount: a.jobCount,
          status,
        };
      }),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------- GET /api/jobs/unassigned ----------
// Returns jobs with no asset identifier custom field value, grouped by client.

router.get("/jobs/unassigned", async (req: Request, res: Response) => {
  const { clientId, search } = req.query;
  const jobberAccountId = req.accountId;

  if (!jobberAccountId || typeof jobberAccountId !== "string") {
    res.status(400).json({ error: "Missing required query param: jobberAccountId" });
    return;
  }

  try {
    const org = await requireOrg(jobberAccountId);
    const fieldLabel = org.assetIdentifierField;
    if (!fieldLabel) {
      res.status(400).json({ error: "No asset identifier field mapped for this org" });
      return;
    }

    // Build WHERE clause incrementally
    const conditions = [
      sql`j.org_id = ${org.id}`,
      sql`NOT EXISTS (
        SELECT 1 FROM job_custom_fields jcf
        WHERE jcf.job_id     = j.id
          AND jcf.field_label = ${fieldLabel}
          AND jcf.field_value IS NOT NULL
          AND jcf.field_value != ''
      )`,
    ];

    if (clientId && typeof clientId === "string") {
      conditions.push(sql`j.jobber_client_id = ${clientId}`);
    }

    if (search && typeof search === "string" && search.trim()) {
      const term = `%${search.trim().toLowerCase()}%`;
      conditions.push(sql`(
        LOWER(COALESCE(j.title, ''))        LIKE ${term}
        OR LOWER(COALESCE(j.instructions, '')) LIKE ${term}
      )`);
    }

    const rows = await db.execute(sql`
      SELECT
        j.id,
        j.jobber_job_id,
        j.jobber_client_id,
        j.job_number,
        j.title,
        j.instructions,
        j.created_at,
        j.job_status,
        j.completed_at
      FROM jobs j
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY j.created_at DESC
    `) as unknown as {
      id: string;
      jobber_job_id: string;
      jobber_client_id: string | null;
      job_number: number | null;
      title: string | null;
      instructions: string | null;
      created_at: Date | string;
      job_status: string;
      completed_at: Date | string | null;
    }[];

    // Fetch client names for all referenced clients
    const clientIds = [...new Set(rows.map((r) => r.jobber_client_id).filter(Boolean))] as string[];
    const clientRows = clientIds.length > 0
      ? await db
          .select({ jobberClientId: clients.jobberClientId, name: clients.name, companyName: clients.companyName })
          .from(clients)
          .where(and(eq(clients.orgId, org.id), inArray(clients.jobberClientId, clientIds)))
      : [];

    const clientNameMap = new Map(clientRows.map((c) => [c.jobberClientId, c.companyName ?? c.name]));

    // Group jobs by client
    const grouped = new Map<string | null, { clientId: string | null; clientName: string | null; jobs: unknown[] }>();

    for (const row of rows) {
      const key = row.jobber_client_id ?? null;
      if (!grouped.has(key)) {
        grouped.set(key, {
          clientId: key,
          clientName: key ? (clientNameMap.get(key) ?? null) : null,
          jobs: [],
        });
      }
      grouped.get(key)!.jobs.push({
        id: row.id,
        jobberJobId: row.jobber_job_id,
        jobNumber: row.job_number,
        title: row.title ?? null,
        instructions: row.instructions ? row.instructions.slice(0, 200) : null,
        startDate: row.created_at ? new Date(row.created_at).toISOString() : null,
        completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
        status: row.job_status,
      });
    }

    res.json({ clients: [...grouped.values()] });
  } catch (err) {
    console.error("[jobs/unassigned] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- GET /api/stats/unassigned-count ----------
// Returns the total number of unassigned jobs for a quick badge/banner count.

router.get("/stats/unassigned-count", async (req: Request, res: Response) => {
  const jobberAccountId = req.accountId;

  if (!jobberAccountId || typeof jobberAccountId !== "string") {
    res.status(400).json({ error: "Missing required query param: jobberAccountId" });
    return;
  }

  try {
    const org = await requireOrg(jobberAccountId);
    const fieldLabel = org.assetIdentifierField;
    if (!fieldLabel) {
      res.json({ count: 0 });
      return;
    }

    const [row] = await db.execute(sql`
      SELECT COUNT(*) AS count
      FROM jobs j
      WHERE j.org_id = ${org.id}
        AND NOT EXISTS (
          SELECT 1 FROM job_custom_fields jcf
          WHERE jcf.job_id     = j.id
            AND jcf.field_label = ${fieldLabel}
            AND jcf.field_value IS NOT NULL
            AND jcf.field_value != ''
        )
    `) as unknown as [{ count: string }];

    res.json({ count: parseInt(String(row.count), 10) });
  } catch (err) {
    console.error("[stats/unassigned-count] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- GET /api/jobs/:jobId/notes (live visit data from Jobber) ----------

router.get("/jobs/:jobId/notes", async (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);
  let jobberAccountId: string | undefined;

  try {
    const [job] = await db.select({ id: jobs.id, jobberJobId: jobs.jobberJobId, orgId: jobs.orgId })
      .from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }

    const [org] = await db.select().from(jobberOrgs).where(eq(jobberOrgs.id, job.orgId)).limit(1);
    if (!org) { res.status(404).json({ error: "Org not found" }); return; }

    jobberAccountId = org.jobberAccountId;

    const accessToken = await getValidToken(org.jobberAccountId);
    const [{ workNotes: visitNotes, technicianName }, { jobNotes }] = await Promise.all([
      fetchJobVisitData(accessToken, job.jobberJobId),
      fetchJobExtras(accessToken, job.jobberJobId),
    ]);
    const noteParts = [visitNotes, jobNotes].filter(Boolean);
    const workNotes = noteParts.length > 0 ? noteParts.join("\n\n") : null;

    res.json({ workNotes, technicianName });
  } catch (err) {
    console.error("[job-notes] error:", err);
    if (isDisconnectError(err) && jobberAccountId) {
      console.log(`[sync] 401 disconnect detected — cleaning up org data for ${jobberAccountId}`);
      await deleteOrgData(jobberAccountId);
      res.status(401).json({ error: "Org disconnected" });
      return;
    }
    res.status(500).json({ error: String(err) });
  }
});

// ---------- helper: fetch first visit's work notes + technician from Jobber ----------

// Fetches visit instructions and technician — this query was confirmed working.
// Kept deliberately narrow so a schema change elsewhere can't break technician.
async function fetchJobVisitData(accessToken: string, jobberJobId: string): Promise<{ workNotes: string | null; technicianName: string | null }> {
  const query = `{
    job(id: ${JSON.stringify(jobberJobId)}) {
      visits(first: 1) {
        nodes {
          instructions
          assignedUsers(first: 1) {
            nodes { name { full } }
          }
        }
      }
    }
  }`;

  try {
    const data = await jobberGql<{
      job?: {
        visits?: {
          nodes: {
            instructions: string | null;
            assignedUsers: { nodes: { name: { full: string } }[] };
          }[];
        };
      };
    }>(accessToken, query);

    const visit = data.job?.visits?.nodes?.[0];
    if (!visit) return { workNotes: null, technicianName: null };

    return {
      workNotes: visit.instructions?.trim() || null,
      technicianName: visit.assignedUsers?.nodes?.[0]?.name?.full ?? null,
    };
  } catch (err) {
    if (isDisconnectError(err)) throw err;
    console.error(`[visit] FAILED for jobberJobId=${jobberJobId}:`, String(err));
    return { workNotes: null, technicianName: null };
  }
}

// Fetches job-level notes (JobNote union type) and line items separately
// so a failure here cannot affect technician or visit instructions.
async function fetchJobExtras(accessToken: string, jobberJobId: string): Promise<{ jobNotes: string | null; lineItems: { name: string; quantity: string }[] }> {
  const query = `{
    job(id: ${JSON.stringify(jobberJobId)}) {
      notes(first: 50) { nodes { ... on JobNote { message } } }
      lineItems(first: 50) { nodes { name quantity } }
    }
  }`;

  try {
    const data = await jobberGql<{
      job?: {
        notes?: { nodes: { message?: string }[] };
        lineItems?: { nodes: { name: string; quantity: number }[] };
      };
    }>(accessToken, query);

    const job = data.job;

    const jobNotes = (job?.notes?.nodes ?? [])
      .map((n) => n.message?.trim())
      .filter(Boolean)
      .join("\n\n") || null;

    const lineItems = (job?.lineItems?.nodes ?? [])
      .filter((li) => li.name)
      .map((li) => ({ name: li.name, quantity: String(li.quantity) }));

    return { jobNotes, lineItems };
  } catch (err) {
    if (isDisconnectError(err)) throw err;
    console.error(`[extras] FAILED for jobberJobId=${jobberJobId}:`, String(err));
    return { jobNotes: null, lineItems: [] };
  }
}

// Fetches photo attachments from all job notes.
async function fetchJobPhotos(accessToken: string, jobberJobId: string): Promise<{ fileName: string; url: string }[]> {
  const query = `{
    job(id: ${JSON.stringify(jobberJobId)}) {
      notes(first: 50) {
        nodes {
          ... on JobNote {
            message
            fileAttachments(first: 50) { nodes { fileName url } }
          }
        }
      }
    }
  }`;

  try {
    const data = await jobberGql<{
      job?: {
        notes?: { nodes: { fileAttachments?: { nodes: { fileName: string; url: string }[] } }[] };
      };
    }>(accessToken, query);

    const rawNotes = data.job?.notes?.nodes ?? [];
    const attachments = rawNotes
      .flatMap((n) => n.fileAttachments?.nodes ?? [])
      .filter((a) => a.url);
    console.log(`[photos] found ${attachments.length} attachment(s) for job ${jobberJobId}`);
    return attachments;
  } catch (err) {
    if (isDisconnectError(err)) throw err;
    console.error(`[photos] FAILED for jobberJobId=${jobberJobId}:`, String(err));
    return [];
  }
}

// Downloads an image URL into a Buffer for PDFKit embedding.
// Returns null on any failure so callers can skip gracefully.
async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[pdf] image fetch failed (${res.status}): ${url}`);
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.warn(`[pdf] image fetch error:`, String(err));
    return null;
  }
}

// ---------- GET /api/jobs/:jobId/photos ----------

router.get("/jobs/:jobId/photos", async (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);

  try {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }

    const [org] = await db.select().from(jobberOrgs).where(eq(jobberOrgs.id, job.orgId)).limit(1);
    if (!org) { res.status(404).json({ error: "Org not found" }); return; }

    const accessToken = await getValidToken(org.jobberAccountId);
    const [photoAttachments, exclusions] = await Promise.all([
      fetchJobPhotos(accessToken, job.jobberJobId),
      db.select().from(excludedPhotos).where(
        and(eq(excludedPhotos.orgId, job.orgId), eq(excludedPhotos.jobberJobId, job.jobberJobId))
      ),
    ]);

    const excludedSet = new Set(exclusions.map((e) => e.filename));
    const photos = photoAttachments.map((a) => ({
      fileName: a.fileName,
      url: a.url,
      excluded: excludedSet.has(a.fileName),
    }));

    res.json({ photos });
  } catch (err) {
    console.error("[photos endpoint] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- POST /api/jobs/:jobId/photos/exclude ----------

router.post("/jobs/:jobId/photos/exclude", async (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);
  const { filename, excluded } = req.body as { filename: string; excluded: boolean };

  if (!filename || typeof excluded !== "boolean") {
    res.status(400).json({ error: "filename and excluded (boolean) are required" });
    return;
  }

  try {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }

    if (excluded) {
      await db
        .insert(excludedPhotos)
        .values({ id: crypto.randomUUID(), orgId: job.orgId, jobberJobId: job.jobberJobId, filename })
        .onConflictDoNothing();
    } else {
      await db
        .delete(excludedPhotos)
        .where(and(
          eq(excludedPhotos.orgId, job.orgId),
          eq(excludedPhotos.jobberJobId, job.jobberJobId),
          eq(excludedPhotos.filename, filename),
        ));
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[photos exclude] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- GET /api/jobs/:jobId/pdf ----------

router.get("/jobs/:jobId/pdf", async (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);
  let jobberAccountId: string | undefined;

  try {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }

    const [org] = await db.select().from(jobberOrgs).where(eq(jobberOrgs.id, job.orgId)).limit(1);
    if (!org) { res.status(404).json({ error: "Org not found" }); return; }

    jobberAccountId = org.jobberAccountId;

    // Client name
    let clientName = "—";
    if (job.jobberClientId) {
      const [client] = await db
        .select({ name: clients.name, companyName: clients.companyName })
        .from(clients)
        .where(and(eq(clients.orgId, job.orgId), eq(clients.jobberClientId, job.jobberClientId)))
        .limit(1);
      if (client) clientName = client.companyName ?? client.name;
    }

    // Live data from Jobber — run sequentially to avoid concurrent rate-limit hits.
    // DB query is independent so it runs in parallel with the first Jobber call.
    const accessToken = await getValidToken(org.jobberAccountId);
    const [dbLineItems, { workNotes: visitNotes, technicianName }] = await Promise.all([
      db.select().from(jobLineItems).where(eq(jobLineItems.jobId, jobId)),
      fetchJobVisitData(accessToken, job.jobberJobId),
    ]);
    const { jobNotes, lineItems: liveLineItems } = await fetchJobExtras(accessToken, job.jobberJobId);
    const [photoAttachments, photoExclusions] = await Promise.all([
      fetchJobPhotos(accessToken, job.jobberJobId),
      db.select().from(excludedPhotos).where(
        and(eq(excludedPhotos.orgId, job.orgId), eq(excludedPhotos.jobberJobId, job.jobberJobId))
      ),
    ]);
    const noteParts = [visitNotes, jobNotes].filter(Boolean);
    const workNotes = noteParts.length > 0 ? noteParts.join("\n\n") : null;
    // Prefer DB line items (synced); fall back to live fetch if DB is empty
    const lineItems = dbLineItems.length > 0
      ? dbLineItems.map((li) => ({ name: li.name, quantity: li.quantity }))
      : liveLineItems;

    const excludedFileNames = new Set(photoExclusions.map((e) => e.filename));
    const includedPhotos = photoAttachments.filter((a) => !excludedFileNames.has(a.fileName));

    // Pre-fetch all images before piping — keeps PDF generation synchronous
    const images = (
      await Promise.all(
        includedPhotos.map(async (a) => {
          const buf = await fetchImageBuffer(a.url);
          return buf ? { buf, fileName: a.fileName } : null;
        })
      )
    ).filter((img): img is { buf: Buffer; fileName: string } => img !== null);

    // Custom fields from DB
    const customFields = await db.select().from(jobCustomFields).where(eq(jobCustomFields.jobId, jobId));
    const assetField = org.assetIdentifierField;
    const assetIdentifier = assetField
      ? (customFields.find((f) => f.fieldLabel === assetField)?.fieldValue ?? "—")
      : "—";
    const displayFields = customFields.filter((f) => f.fieldLabel !== assetField);

    const completedStr = job.completedAt
      ? new Date(job.completedAt).toLocaleDateString("en-GB", { dateStyle: "medium" })
      : "—";

    // ── Build PDF ────────────────────────────────────────────────
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const L = 50;
    const R = (doc.page.width as number) - 50;
    const W = R - L;
    const navy = "#1e293b";
    const slate = "#64748b";
    const rule = "#e2e8f0";

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="service-report-${job.jobNumber ?? jobId}.pdf"`
    );
    doc.pipe(res);

    try {

    // Header bar
    doc.rect(0, 0, doc.page.width as number, 78).fill(navy);
    doc.fillColor("white").fontSize(22).font("Helvetica-Bold").text("Service Report", L, 20);
    doc.fillColor("#94a3b8").fontSize(10).font("Helvetica").text("AssetMinder", L, 48);

    let y = 98;

    // Asset / Client
    doc.fillColor(slate).fontSize(8).font("Helvetica")
      .text("ASSET", L, y, { width: W / 2 });
    doc.text("CLIENT", L + W / 2, y, { width: W / 2 });
    y += 14;
    doc.fillColor(navy).fontSize(15).font("Helvetica-Bold")
      .text(assetIdentifier, L, y, { width: W / 2 });
    doc.text(clientName, L + W / 2, y, { width: W / 2 });
    y += 36;

    // Divider
    doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(rule).stroke();
    y += 16;

    // Job details — 3 columns: number, date completed, technician
    const details = [
      { label: "JOB NUMBER", value: job.jobNumber ? `#${job.jobNumber}` : "—" },
      { label: "DATE COMPLETED", value: completedStr },
      { label: "TECHNICIAN", value: technicianName ?? "—" },
    ];
    const colW = W / details.length;
    details.forEach((d, i) => {
      const x = L + i * colW;
      doc.fillColor(slate).fontSize(8).font("Helvetica").text(d.label, x, y, { width: colW });
      doc.fillColor(navy).fontSize(11).font("Helvetica-Bold").text(d.value, x, y + 13, { width: colW });
    });
    y += 46;

    // Job title (if present)
    if (job.title) {
      doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(rule).stroke();
      y += 16;
      doc.fillColor(slate).fontSize(8).font("Helvetica").text("JOB TITLE", L, y);
      y += 13;
      doc.fillColor(navy).fontSize(12).font("Helvetica-Bold").text(job.title, L, y, { width: W });
      y += 24;
    }

    // Work carried out (visit instructions — most important section)
    const workNotesText = workNotes ?? job.instructions;
    if (workNotesText) {
      doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(rule).stroke();
      y += 16;
      // Highlighted label
      doc.fillColor(slate).fontSize(8).font("Helvetica").text("WORK CARRIED OUT", L, y);
      y += 13;
      // Light background box
      const textHeight = doc.heightOfString(workNotesText, { width: W });
      doc.rect(L, y - 6, W, textHeight + 16).fill("#f1f5f9");
      doc.fillColor(navy).fontSize(11).font("Helvetica").text(workNotesText, L + 10, y, { width: W - 20 });
      y += textHeight + 24;
    }

    // Parts & materials
    if (lineItems.length > 0) {
      doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(rule).stroke();
      y += 16;
      doc.fillColor(slate).fontSize(8).font("Helvetica").text("PARTS & MATERIALS", L, y);
      y += 14;
      lineItems.forEach((li) => {
        const qty = parseFloat(li.quantity);
        const qtyStr = Number.isInteger(qty) ? String(Math.round(qty)) : qty.toFixed(2).replace(/\.?0+$/, "");
        const line = `• ${li.name} x${qtyStr}`;
        doc.fillColor(navy).fontSize(10).font("Helvetica").text(line, L, y, { width: W });
        y += 17;
      });
      y += 4;
    }

    // Photos — images already fetched above; generation is fully synchronous here
    if (images.length > 0) {
      doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(rule).stroke();
      y += 16;
      doc.fillColor(slate).fontSize(8).font("Helvetica").text("PHOTOS", L, y);
      y += 14;

      const imgW = 240;
      const imgMaxH = 180;
      const colGap = W - imgW * 2;

      for (let i = 0; i < images.length; i += 2) {
        if (y + imgMaxH + 20 > (doc.page.height as number) - 60) {
          doc.addPage();
          y = 50;
        }

        const rowStart = y;
        const left = images[i];
        const right = images[i + 1] ?? null;

        try {
          doc.image(left.buf, L, rowStart, { fit: [imgW, imgMaxH] });
        } catch (err) {
          console.warn(`[pdf] failed to embed image "${left.fileName}":`, String(err));
        }
        if (right) {
          try {
            doc.image(right.buf, L + imgW + colGap, rowStart, { fit: [imgW, imgMaxH] });
          } catch (err) {
            console.warn(`[pdf] failed to embed image "${right.fileName}":`, String(err));
          }
        }

        y = rowStart + imgMaxH + 4;
        doc.fillColor(slate).fontSize(8).font("Helvetica")
          .text(left.fileName, L, y, { width: imgW });
        if (right) {
          doc.fillColor(slate).fontSize(8).font("Helvetica")
            .text(right.fileName, L + imgW + colGap, y, { width: imgW });
        }
        y += 20;
      }
    }

    // Custom fields
    if (displayFields.length > 0) {
      doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(rule).stroke();
      y += 16;
      doc.fillColor(slate).fontSize(8).font("Helvetica").text("JOB DETAILS", L, y);
      y += 14;
      displayFields.forEach((f) => {
        doc.fillColor(slate).fontSize(9).font("Helvetica")
          .text(`${f.fieldLabel}:`, L, y, { width: 160 });
        doc.fillColor(navy).fontSize(9).font("Helvetica-Bold")
          .text(f.fieldValue ?? "—", L + 165, y, { width: W - 165 });
        y += 18;
      });
    }

    // Footer
    const pageH = doc.page.height as number;
    // Derive the display host from FRONTEND_URL so the footer never goes stale.
    // Uses the prod URL as fallback (unlike functional links) since a customer-
    // facing PDF should never print "localhost:3000".
    const footerHost = (process.env.FRONTEND_URL ?? "https://www.minderapps.io")
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    doc.moveTo(L, pageH - 50).lineTo(R, pageH - 50).lineWidth(0.5).strokeColor(rule).stroke();
    doc.fillColor(slate).fontSize(8).font("Helvetica")
      .text(`Generated by AssetMinder · ${footerHost}`, L, pageH - 36, { width: W, align: "center" });

    } finally {
      doc.end();
    }
  } catch (err) {
    console.error("[pdf] error:", err);
    if (isDisconnectError(err) && jobberAccountId) {
      console.log(`[sync] 401 disconnect detected — cleaning up org data for ${jobberAccountId}`);
      await deleteOrgData(jobberAccountId);
      if (!res.headersSent) res.status(401).json({ error: "Org disconnected" });
      return;
    }
    if (!res.headersSent) res.status(500).json({ error: String(err) });
  }
});

// ---------- GET /api/settings ----------

router.get("/settings", async (req: Request, res: Response) => {
  const jobberAccountId = req.accountId;

  if (!jobberAccountId || typeof jobberAccountId !== "string") {
    res.status(400).json({ error: "Missing required query param: jobberAccountId" });
    return;
  }

  try {
    const org = await requireOrg(jobberAccountId);
    const [settings] = await db
      .select()
      .from(orgSettings)
      .where(eq(orgSettings.orgId, org.id))
      .limit(1);

    res.json({ serviceKeywords: settings?.serviceKeywords ?? [] });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------- POST /api/settings ----------

router.post("/settings", async (req: Request, res: Response) => {
  const { serviceKeywords } = req.body as {
    serviceKeywords?: string[];
  };
  const jobberAccountId = req.accountId;

  if (!jobberAccountId) {
    res.status(400).json({ error: "Missing required body param: jobberAccountId" });
    return;
  }
  if (!Array.isArray(serviceKeywords)) {
    res.status(400).json({ error: "serviceKeywords must be an array of strings" });
    return;
  }

  try {
    const org = await requireOrg(jobberAccountId);
    const cleaned = serviceKeywords.map((k) => k.trim()).filter(Boolean);

    await db
      .insert(orgSettings)
      .values({ id: crypto.randomUUID(), orgId: org.id, serviceKeywords: cleaned })
      .onConflictDoUpdate({
        target: orgSettings.orgId,
        set: { serviceKeywords: cleaned },
      });

    res.json({ ok: true, serviceKeywords: cleaned });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------- POST /api/disconnect ----------

router.post("/disconnect", async (req: Request, res: Response) => {
  const jobberAccountId = req.accountId;

  if (!jobberAccountId) {
    res.status(400).json({ error: "Missing required body param: jobberAccountId" });
    return;
  }

  try {
    // Step 1: Cancel Stripe subscription before data is gone
    const [org] = await db
      .select()
      .from(jobberOrgs)
      .where(eq(jobberOrgs.jobberAccountId, jobberAccountId))
      .limit(1);

    if (org?.stripeSubscriptionId) {
      try {
        await stripe.subscriptions.cancel(org.stripeSubscriptionId);
        console.log(`[disconnect] Stripe subscription ${org.stripeSubscriptionId} cancelled immediately`);
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "resource_missing") {
          console.log(`[disconnect] Stripe subscription ${org.stripeSubscriptionId} not found — skipping`);
        } else {
          console.warn(`[disconnect] Stripe cancellation error (non-blocking):`, String(err));
        }
      }
    } else {
      console.log(`[disconnect] no stripeSubscriptionId for ${jobberAccountId} — skipping Stripe step`);
    }

    // Step 2: Call Jobber's appDisconnect mutation before deleting local data so the token is still valid.
    let accessToken: string | null = null;
    try {
      accessToken = await getValidToken(jobberAccountId);
      console.log(`[disconnect] got valid token for ${jobberAccountId}, calling appDisconnect mutation`);
    } catch (err) {
      console.warn(`[disconnect] could not get token for ${jobberAccountId} — skipping mutation:`, String(err));
    }

    if (accessToken) {
      try {
        const mutationRes = await fetch(JOBBER_GRAPHQL_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            "X-JOBBER-GRAPHQL-VERSION": JOBBER_API_VERSION,
          },
          body: JSON.stringify({ query: "mutation { appDisconnect { userErrors { message } } }" }),
        });
        const body = await mutationRes.text();
        console.log(`[disconnect] appDisconnect response — HTTP ${mutationRes.status}: ${body}`);
      } catch (err) {
        console.warn(`[disconnect] appDisconnect mutation network error:`, String(err));
      }
    }

    // Step 3: Delete all local data for this org
    await deleteOrgData(jobberAccountId);

    res.json({ ok: true });
  } catch (err) {
    console.error("[disconnect] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

export default router;
