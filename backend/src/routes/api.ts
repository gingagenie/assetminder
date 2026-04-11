import { Router, Request, Response } from "express";
import { eq, and, inArray, desc } from "drizzle-orm";
import crypto from "crypto";
import { getValidToken } from "../lib/jobberToken";
import { syncOrg } from "../lib/sync";
import { groupAssets } from "../lib/groupAssets";
import { calculateDueDates } from "../lib/calculateDueDates";
import { db } from "../db/client";
import { jobberOrgs, assets, jobs, jobCustomFields, clients } from "../db/schema";

const router = Router();

const JOBBER_GRAPHQL_URL = "https://api.getjobber.com/api/graphql";
const JOBBER_API_VERSION = "2025-04-16";

// ---------- helpers ----------

async function jobberGql<T>(accessToken: string, query: string): Promise<T> {
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
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join(", "));

  return json.data as T;
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

// ---------- GET /api/me ----------

router.get("/me", async (req: Request, res: Response) => {
  const { jobberAccountId } = req.query;

  if (!jobberAccountId || typeof jobberAccountId !== "string") {
    res.status(400).json({ error: "Missing required query param: jobberAccountId" });
    return;
  }

  try {
    const accessToken = await getValidToken(jobberAccountId);
    const data = await jobberGql<{ account: { name: string } }>(accessToken, "{ account { name } }");
    res.json({ accountName: data.account.name });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------- POST /api/sync ----------

router.post("/sync", async (req: Request, res: Response) => {
  const { jobberAccountId } = req.body as { jobberAccountId?: string };

  if (!jobberAccountId) {
    res.status(400).json({ error: "Missing required body param: jobberAccountId" });
    return;
  }

  try {
    const result = await syncOrg(jobberAccountId);
    res.json(result);
  } catch (err) {
    console.error("[sync] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- GET /api/custom-fields ----------

const CUSTOM_FIELD_CONFIGS_QUERY = `
  {
    customFieldConfigurations(first: 100) {
      nodes {
        ... on CustomFieldConfigurationText      { id name appliesTo archived }
        ... on CustomFieldConfigurationNumeric   { id name appliesTo archived }
        ... on CustomFieldConfigurationDropdown  { id name appliesTo archived }
        ... on CustomFieldConfigurationArea      { id name appliesTo archived }
        ... on CustomFieldConfigurationLink      { id name appliesTo archived }
        ... on CustomFieldConfigurationTrueFalse { id name appliesTo archived }
      }
    }
  }
`;

router.get("/custom-fields", async (req: Request, res: Response) => {
  const { jobberAccountId } = req.query;

  if (!jobberAccountId || typeof jobberAccountId !== "string") {
    res.status(400).json({ error: "Missing required query param: jobberAccountId" });
    return;
  }

  try {
    const accessToken = await getValidToken(jobberAccountId);
    const data = await jobberGql<{
      customFieldConfigurations: {
        nodes: { id: string; name: string; appliesTo: string; archived: boolean }[];
      };
    }>(accessToken, CUSTOM_FIELD_CONFIGS_QUERY);

    const fields = data.customFieldConfigurations.nodes
      .filter((n) => n.appliesTo?.toUpperCase().includes("JOB") && !n.archived)
      .map((n) => ({ id: n.id, label: n.name }));

    res.json({ fields });
  } catch (err) {
    console.error("[custom-fields] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- POST /api/orgs/field-mapping ----------

router.post("/orgs/field-mapping", async (req: Request, res: Response) => {
  const { jobberAccountId, fieldLabel } = req.body as {
    jobberAccountId?: string;
    fieldLabel?: string;
  };

  if (!jobberAccountId || !fieldLabel) {
    res.status(400).json({ error: "Missing required body params: jobberAccountId, fieldLabel" });
    return;
  }

  try {
    const org = await requireOrg(jobberAccountId);

    await db
      .update(jobberOrgs)
      .set({ assetIdentifierField: fieldLabel, updatedAt: new Date() })
      .where(eq(jobberOrgs.id, org.id));

    res.json({ ok: true, jobberAccountId, assetIdentifierField: fieldLabel });
  } catch (err) {
    console.error("[field-mapping] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- GET /api/orgs/field-mapping ----------

router.get("/orgs/field-mapping", async (req: Request, res: Response) => {
  const { jobberAccountId } = req.query;

  if (!jobberAccountId || typeof jobberAccountId !== "string") {
    res.status(400).json({ error: "Missing required query param: jobberAccountId" });
    return;
  }

  try {
    const org = await requireOrg(jobberAccountId);
    res.json({ assetIdentifierField: org.assetIdentifierField ?? null });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------- POST /api/assets/:assetId/interval ----------

router.post("/assets/:assetId/interval", async (req: Request, res: Response) => {
  const { assetId } = req.params;
  const { intervalDays } = req.body as { intervalDays?: number };

  if (!intervalDays || typeof intervalDays !== "number" || intervalDays < 1) {
    res.status(400).json({ error: "intervalDays must be a positive integer" });
    return;
  }

  try {
    const [updated] = await db
      .update(assets)
      .set({ serviceIntervalDays: Math.round(intervalDays) })
      .where(eq(assets.id, String(assetId)))
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

// ---------- POST /api/calculate-due-dates ----------

router.post("/calculate-due-dates", async (req: Request, res: Response) => {
  const { jobberAccountId } = req.body as { jobberAccountId?: string };

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
  const { jobberAccountId } = req.body as { jobberAccountId?: string };

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

    // Jobs linked to this asset via the identifier custom field
    const jobRows = await db
      .select({
        id: jobs.id,
        jobberJobId: jobs.jobberJobId,
        jobNumber: jobs.jobNumber,
        title: jobs.title,
        completedAt: jobs.completedAt,
        jobStatus: jobs.jobStatus,
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

    // Enrich jobs with live Jobber data: line items, assignee, instructions
    interface LineItem { name: string; quantity: number; unitPrice: number; total: number }
    interface JobberDetail {
      lineItems?: { nodes: LineItem[] };
      assignedTo?: { nodes: { name: string }[] } | null;
      instructions?: string | null;
    }
    const enrichedMap = new Map<string, JobberDetail>();

    if (jobRows.length > 0) {
      try {
        const accessToken = await getValidToken(org.jobberAccountId);
        const aliases = jobRows
          .map((j, i) =>
            `j${i}: node(id: ${JSON.stringify(j.jobberJobId)}) {
              ... on Job {
                lineItems { nodes { name quantity unitPrice total } }
                assignedTo { nodes { name } }
                instructions
              }
            }`
          )
          .join("\n");

        const jobberData = await jobberGql<Record<string, JobberDetail>>(accessToken, `{ ${aliases} }`);
        jobRows.forEach((j, i) => {
          const detail = jobberData[`j${i}`];
          if (detail) enrichedMap.set(j.id, detail);
        });
      } catch (err) {
        console.error("[asset-jobs] Jobber enrichment failed (non-fatal):", err);
      }
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
      },
      jobs: jobRows.map((j) => {
        const detail = enrichedMap.get(j.id);
        return {
          id: j.id,
          jobberJobId: j.jobberJobId,
          jobNumber: j.jobNumber,
          title: j.title,
          completedAt: j.completedAt ?? null,
          jobStatus: j.jobStatus,
          customFields: fieldsByJob.get(j.id) ?? [],
          lineItems: detail?.lineItems?.nodes ?? [],
          technicianName: detail?.assignedTo?.nodes?.[0]?.name ?? null,
          instructions: detail?.instructions ?? null,
        };
      }),
    });
  } catch (err) {
    console.error("[asset-jobs] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- GET /api/assets ----------

router.get("/assets", async (req: Request, res: Response) => {
  const { jobberAccountId, clientId } = req.query;

  if (!jobberAccountId || typeof jobberAccountId !== "string") {
    res.status(400).json({ error: "Missing required query param: jobberAccountId" });
    return;
  }

  try {
    const org = await requireOrg(jobberAccountId);

    const rows = await db
      .select()
      .from(assets)
      .where(
        clientId && typeof clientId === "string"
          ? and(eq(assets.orgId, org.id), eq(assets.jobberClientId, clientId))
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
  const { jobberAccountId } = req.query;

  if (!jobberAccountId || typeof jobberAccountId !== "string") {
    res.status(400).json({ error: "Missing required query param: jobberAccountId" });
    return;
  }

  try {
    const org = await requireOrg(jobberAccountId);
    const rows = await db
      .select({ id: clients.id, name: clients.name, companyName: clients.companyName, email: clients.email, jobberClientId: clients.jobberClientId, portalToken: clients.portalToken })
      .from(clients)
      .where(eq(clients.orgId, org.id));

    res.json({ clients: rows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------- POST /api/clients/:clientId/portal-link ----------

router.post("/clients/:clientId/portal-link", async (req: Request, res: Response) => {
  const clientId = String(req.params.clientId);
  const frontendBase = process.env.FRONTEND_URL ?? "http://localhost:3000";

  try {
    const [existing] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
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

export default router;
