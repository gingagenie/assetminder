import { Router, Request, Response } from "express";
import { eq, and, inArray, desc } from "drizzle-orm";
import crypto from "crypto";
import PDFDocument from "pdfkit";
import { getValidToken } from "../lib/jobberToken";
import { syncOrg } from "../lib/sync";
import { groupAssets } from "../lib/groupAssets";
import { calculateDueDates } from "../lib/calculateDueDates";
import { deleteOrgData } from "../lib/deleteOrg";
import { db } from "../db/client";
import { jobberOrgs, assets, jobs, jobCustomFields, clients, jobLineItems } from "../db/schema";

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
  const { intervalDays, jobberAccountId } = req.body as { intervalDays?: number; jobberAccountId?: string };

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
      .set({ serviceIntervalDays: Math.round(intervalDays) })
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
  const { jobberAccountId } = req.body as { jobberAccountId?: string };
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

// ---------- GET /api/jobs/:jobId/notes (live visit data from Jobber) ----------

router.get("/jobs/:jobId/notes", async (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);

  try {
    const [job] = await db.select({ id: jobs.id, jobberJobId: jobs.jobberJobId, orgId: jobs.orgId })
      .from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }

    const [org] = await db.select().from(jobberOrgs).where(eq(jobberOrgs.id, job.orgId)).limit(1);
    if (!org) { res.status(404).json({ error: "Org not found" }); return; }

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
          assignedUsers {
            nodes { name { full } }
          }
        }
      }
    }
  }`;

  try {
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
    const json = JSON.parse(text) as {
      data?: {
        job?: {
          visits?: {
            nodes: {
              instructions: string | null;
              assignedUsers: { nodes: { name: { full: string } }[] };
            }[];
          };
        };
      };
      errors?: { message: string }[];
    };

    if (json.errors?.length) {
      console.error(`[visit] GraphQL errors:`, json.errors.map(e => e.message).join(", "));
      return { workNotes: null, technicianName: null };
    }

    const visit = json.data?.job?.visits?.nodes?.[0];
    if (!visit) return { workNotes: null, technicianName: null };

    return {
      workNotes: visit.instructions?.trim() || null,
      technicianName: visit.assignedUsers?.nodes?.[0]?.name?.full ?? null,
    };
  } catch (err) {
    console.error(`[visit] FAILED for jobberJobId=${jobberJobId}:`, String(err));
    return { workNotes: null, technicianName: null };
  }
}

// Fetches job-level notes (JobNote union type) and line items separately
// so a failure here cannot affect technician or visit instructions.
async function fetchJobExtras(accessToken: string, jobberJobId: string): Promise<{ jobNotes: string | null; lineItems: { name: string; quantity: string }[]; photoAttachments: { fileName: string; url: string }[] }> {
  const query = `{
    job(id: ${JSON.stringify(jobberJobId)}) {
      notes {
        nodes {
          ... on JobNote {
            message
            fileAttachments { nodes { fileName url } }
          }
        }
      }
      lineItems { nodes { name quantity } }
    }
  }`;

  try {
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
    const json = JSON.parse(text) as {
      data?: {
        job?: {
          notes?: { nodes: { message?: string; fileAttachments?: { nodes: { fileName: string; url: string }[] } }[] };
          lineItems?: { nodes: { name: string; quantity: number }[] };
        };
      };
      errors?: { message: string }[];
    };

    if (json.errors?.length) {
      console.error(`[extras] GraphQL errors:`, json.errors.map(e => e.message).join(", "));
    }

    const job = json.data?.job;

    const jobNotes = (job?.notes?.nodes ?? [])
      .map((n) => n.message?.trim())
      .filter(Boolean)
      .join("\n\n") || null;

    const lineItems = (job?.lineItems?.nodes ?? [])
      .filter((li) => li.name)
      .map((li) => ({ name: li.name, quantity: String(li.quantity) }));

    const photoAttachments = (job?.notes?.nodes ?? [])
      .flatMap((n) => n.fileAttachments?.nodes ?? [])
      .filter((a) => a.url);

    return { jobNotes, lineItems, photoAttachments };
  } catch (err) {
    console.error(`[extras] FAILED for jobberJobId=${jobberJobId}:`, String(err));
    return { jobNotes: null, lineItems: [], photoAttachments: [] };
  }
}

// ---------- helper: fetch image as Buffer for PDF embedding ----------

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

// ---------- GET /api/jobs/:jobId/pdf ----------

router.get("/jobs/:jobId/pdf", async (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);

  try {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }

    const [org] = await db.select().from(jobberOrgs).where(eq(jobberOrgs.id, job.orgId)).limit(1);
    if (!org) { res.status(404).json({ error: "Org not found" }); return; }

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

    // Live data from Jobber — two separate queries so extras can't break technician
    const accessToken = await getValidToken(org.jobberAccountId);
    const [dbLineItems, [{ workNotes: visitNotes, technicianName }, { jobNotes, lineItems: liveLineItems, photoAttachments }]] = await Promise.all([
      db.select().from(jobLineItems).where(eq(jobLineItems.jobId, jobId)),
      Promise.all([
        fetchJobVisitData(accessToken, job.jobberJobId),
        fetchJobExtras(accessToken, job.jobberJobId),
      ]),
    ]);
    const noteParts = [visitNotes, jobNotes].filter(Boolean);
    const workNotes = noteParts.length > 0 ? noteParts.join("\n\n") : null;
    // Prefer DB line items (synced); fall back to live fetch if DB is empty
    const lineItems = dbLineItems.length > 0
      ? dbLineItems.map((li) => ({ name: li.name, quantity: li.quantity }))
      : liveLineItems;

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
      `attachment; filename="service-report-${job.jobNumber ?? jobId}.pdf"`
    );
    doc.pipe(res);

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

    // Photos
    if (photoAttachments.length > 0) {
      const images = (
        await Promise.all(
          photoAttachments.map(async (a) => {
            const buf = await fetchImageBuffer(a.url);
            return buf ? { buf, fileName: a.fileName } : null;
          })
        )
      ).filter((img): img is { buf: Buffer; fileName: string } => img !== null);

      if (images.length > 0) {
        doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(rule).stroke();
        y += 16;
        doc.fillColor(slate).fontSize(8).font("Helvetica").text("PHOTOS", L, y);
        y += 14;

        const imgW = 240;
        const imgMaxH = 180;
        const colGap = W - imgW * 2; // remaining space between two columns

        for (let i = 0; i < images.length; i += 2) {
          // Page-overflow guard: add new page if not enough room for an image row + caption
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

          // Captions
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
    doc.moveTo(L, pageH - 50).lineTo(R, pageH - 50).lineWidth(0.5).strokeColor(rule).stroke();
    doc.fillColor(slate).fontSize(8).font("Helvetica")
      .text("Generated by AssetMinder · assetminder-frontend.onrender.com", L, pageH - 36, { width: W, align: "center" });

    doc.end();
  } catch (err) {
    console.error("[pdf] error:", err);
    if (!res.headersSent) res.status(500).json({ error: String(err) });
  }
});

// ---------- POST /api/disconnect ----------

router.post("/disconnect", async (req: Request, res: Response) => {
  const { jobberAccountId } = req.body as { jobberAccountId?: string };

  if (!jobberAccountId) {
    res.status(400).json({ error: "Missing required body param: jobberAccountId" });
    return;
  }

  try {
    // Best-effort: call Jobber's appDisconnect mutation to revoke the OAuth tokens.
    // We do this before deleting local data so the token is still valid when we call it.
    const accessToken = await getValidToken(jobberAccountId).catch(() => null);
    if (accessToken) {
      await fetch(JOBBER_GRAPHQL_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "X-JOBBER-GRAPHQL-VERSION": JOBBER_API_VERSION,
        },
        body: JSON.stringify({ query: "mutation { appDisconnect { success } }" }),
      }).catch((err) => console.warn("[disconnect] appDisconnect mutation failed:", err));
    }

    // Delete all local data for this org
    await deleteOrgData(jobberAccountId);

    res.json({ ok: true });
  } catch (err) {
    console.error("[disconnect] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

export default router;
