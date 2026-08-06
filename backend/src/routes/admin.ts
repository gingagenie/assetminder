import { Router, Request, Response, NextFunction } from "express";
import { db } from "../db/client";
import { jobberOrgs, loginEvents, clients, assets, jobs, jobCustomFields, jobLineItems, orgNotes } from "../db/schema";
import { eq, sql, desc, inArray, and } from "drizzle-orm";
import { deleteOrgData } from "../lib/deleteOrg";
import { forceRefreshToken } from "../lib/jobberToken";
import crypto from "crypto";

const JOBBER_GRAPHQL_URL = "https://api.getjobber.com/api/graphql";
const JOBBER_API_VERSION = "2025-04-16";

const router = Router();

const MRR_PER_ACTIVE = 29;

// ---------- auth ----------

function requireAdminKey(req: Request, res: Response, next: NextFunction) {
  const key = req.query.key as string | undefined;
  if (!process.env.ADMIN_SECRET_KEY || key !== process.env.ADMIN_SECRET_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

router.use(requireAdminKey);

// ---------- helpers ----------

function computeTrialEnd(org: { trialStartedAt: Date | null; createdAt: Date }) {
  const start = org.trialStartedAt ?? org.createdAt;
  return new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);
}

function computeEffectiveStatus(org: { subscriptionStatus: string; trialStartedAt: Date | null; createdAt: Date }) {
  if (org.subscriptionStatus === "active") return "active";
  const trialEnd = computeTrialEnd(org);
  if (org.subscriptionStatus === "trial" && Date.now() > trialEnd.getTime()) return "expired";
  return org.subscriptionStatus;
}

// ---------- GET /api/admin/dashboard ----------

router.get("/dashboard", async (_req: Request, res: Response) => {
  const orgs = await db.select().from(jobberOrgs).orderBy(sql`created_at desc`);

  const now = Date.now();
  const in24h = now + 24 * 60 * 60 * 1000;
  const in3d = now + 3 * 24 * 60 * 60 * 1000;

  const flagCounts = { disconnectedTrial: 0, tokenExpiring: 0, abandonedCheckout: 0, lapsingCold: 0 };

  const enriched = orgs.map((org) => {
    const trialEnd = computeTrialEnd(org);
    const status = computeEffectiveStatus(org);
    const orgFlags: string[] = [];

    // Trial orgs that are currently disconnected (broken/unusable)
    if (org.subscriptionStatus === "trial" && org.disconnectedAt) {
      orgFlags.push("disconnectedTrial");
      flagCounts.disconnectedTrial++;
    }

    // Token expiring within 24h on a connected org
    if (!org.disconnectedAt && org.expiresAt && org.expiresAt.getTime() < in24h) {
      orgFlags.push("tokenExpiring");
      flagCounts.tokenExpiring++;
    }

    // Has Stripe customer but no active subscription (abandoned checkout)
    if (org.stripeCustomerId && status !== "active") {
      orgFlags.push("abandonedCheckout");
      flagCounts.abandonedCheckout++;
    }

    // Trial ending within 3 days with no Stripe customer (cold lapse risk)
    if (status === "trial" && trialEnd.getTime() < in3d && !org.stripeCustomerId) {
      orgFlags.push("lapsingCold");
      flagCounts.lapsingCold++;
    }

    return {
      id: org.id,
      jobberAccountId: org.jobberAccountId,
      displayName: org.name ?? org.lastKnownName ?? null,
      disconnectedAt: org.disconnectedAt?.toISOString() ?? null,
      createdAt: org.createdAt,
      trialStartedAt: org.trialStartedAt,
      trialEndsAt: trialEnd,
      subscriptionStatus: status,
      stripeCustomerId: org.stripeCustomerId,
      stripeSubscriptionId: org.stripeSubscriptionId,
      assetIdentifierField: org.assetIdentifierField,
      flags: orgFlags,
    };
  });

  const total = enriched.length;
  const active = enriched.filter((o) => o.subscriptionStatus === "active").length;
  const trial = enriched.filter((o) => o.subscriptionStatus === "trial").length;
  const expired = enriched.filter((o) => o.subscriptionStatus === "expired").length;
  const mrr = active * MRR_PER_ACTIVE;

  res.json({ stats: { total, active, trial, expired, mrr, flags: flagCounts }, orgs: enriched });
});

// ---------- POST /api/admin/orgs/:id/extend-trial ----------

router.post("/orgs/:id/extend-trial", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const [org] = await db.select().from(jobberOrgs).where(eq(jobberOrgs.id, id)).limit(1);
  if (!org) { res.status(404).json({ error: "Org not found" }); return; }

  // Only valid for expired accounts — trial/active accounts use Gift instead.
  // Keeping this server-side regardless of whether the frontend button is disabled.
  if (org.subscriptionStatus !== "expired") {
    res.status(409).json({ error: "extend-trial only applies to expired accounts" });
    return;
  }

  // Set trialStartedAt = now so trialEnd = now + 14d.
  // Writing a fresh value overwrites any stale/stacked date on the row.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = new Date();
  const newStart = now;

  await db.update(jobberOrgs)
    .set({ trialStartedAt: newStart, subscriptionStatus: "trial", updatedAt: new Date() })
    .where(eq(jobberOrgs.id, id));

  res.json({ ok: true });
});

// ---------- POST /api/admin/orgs/:id/set-active ----------

router.post("/orgs/:id/set-active", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const [org] = await db.select().from(jobberOrgs).where(eq(jobberOrgs.id, id)).limit(1);
  if (!org) { res.status(404).json({ error: "Org not found" }); return; }

  await db.update(jobberOrgs)
    .set({ subscriptionStatus: "active", updatedAt: new Date() })
    .where(eq(jobberOrgs.id, id));

  res.json({ ok: true });
});

// ---------- POST /api/admin/orgs/:id/set-expired ----------

router.post("/orgs/:id/set-expired", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const [org] = await db.select().from(jobberOrgs).where(eq(jobberOrgs.id, id)).limit(1);
  if (!org) { res.status(404).json({ error: "Org not found" }); return; }

  await db.update(jobberOrgs)
    .set({ subscriptionStatus: "expired", updatedAt: new Date() })
    .where(eq(jobberOrgs.id, id));

  res.json({ ok: true });
});

// ---------- GET /api/admin/login-events ----------

router.get("/login-events", async (_req: Request, res: Response) => {
  const events = await db
    .select({
      id: loginEvents.id,
      jobberAccountId: loginEvents.jobberAccountId,
      orgName: sql<string | null>`COALESCE(
        ${jobberOrgs.name},
        (SELECT COALESCE(${clients.companyName}, ${clients.name}) FROM clients WHERE clients.org_id = ${jobberOrgs.id} ORDER BY clients.created_at LIMIT 1)
      )`,
      eventType: loginEvents.eventType,
      createdAt: loginEvents.createdAt,
    })
    .from(loginEvents)
    .leftJoin(jobberOrgs, eq(jobberOrgs.jobberAccountId, loginEvents.jobberAccountId))
    .orderBy(desc(loginEvents.createdAt))
    .limit(20);
  res.json({ events });
});

// ---------- DELETE /api/admin/orgs/:id ----------

router.delete("/orgs/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const [org] = await db.select().from(jobberOrgs).where(eq(jobberOrgs.id, id)).limit(1);
  if (!org) { res.status(404).json({ error: "Org not found" }); return; }

  await deleteOrgData(org.jobberAccountId);
  res.json({ ok: true });
});

// ---------- POST /api/admin/bulk/extend-trial ----------

router.post("/bulk/extend-trial", async (req: Request, res: Response) => {
  const { ids } = req.body as { ids?: string[] };
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids required" }); return; }

  let extended = 0;
  for (const id of ids) {
    const [org] = await db.select().from(jobberOrgs).where(eq(jobberOrgs.id, id)).limit(1);
    if (!org || org.subscriptionStatus !== "expired") continue;
    await db.update(jobberOrgs)
      .set({ trialStartedAt: new Date(), subscriptionStatus: "trial", updatedAt: new Date() })
      .where(eq(jobberOrgs.id, id));
    extended++;
  }
  res.json({ ok: true, extended, skipped: ids.length - extended });
});

// ---------- POST /api/admin/bulk/add-tag ----------

router.post("/bulk/add-tag", async (req: Request, res: Response) => {
  const { ids, tag } = req.body as { ids?: string[]; tag?: string };
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids required" }); return; }
  if (!tag || !ALLOWED_TAGS.includes(tag)) { res.status(400).json({ error: "Invalid tag" }); return; }

  let count = 0;
  for (const id of ids) {
    const [org] = await db.select({ tags: jobberOrgs.tags }).from(jobberOrgs).where(eq(jobberOrgs.id, id)).limit(1);
    if (!org) continue;
    const existing = org.tags ?? [];
    if (existing.includes(tag)) continue;
    await db.update(jobberOrgs).set({ tags: [...existing, tag], updatedAt: new Date() }).where(eq(jobberOrgs.id, id));
    count++;
  }
  res.json({ ok: true, count });
});

// ---------- GET /api/admin/orgs/:id (detail) ----------

const ALLOWED_TAGS = ["follow up", "suspicious", "VIP", "needs reconnect"];

router.get("/orgs/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const [org] = await db.select().from(jobberOrgs).where(eq(jobberOrgs.id, id)).limit(1);
  if (!org) { res.status(404).json({ error: "Org not found" }); return; }

  const [
    [assetRow],
    [clientRow],
    [jobRow],
    [lastLoginRow],
    timeline,
    notes,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(assets).where(eq(assets.orgId, org.id)),
    db.select({ count: sql<number>`count(*)::int` }).from(clients).where(eq(clients.orgId, org.id)),
    db.select({ count: sql<number>`count(*)::int` }).from(jobs).where(eq(jobs.orgId, org.id)),
    db
      .select({ createdAt: loginEvents.createdAt })
      .from(loginEvents)
      .where(eq(loginEvents.jobberAccountId, org.jobberAccountId))
      .orderBy(desc(loginEvents.createdAt))
      .limit(1),
    db
      .select({ id: loginEvents.id, eventType: loginEvents.eventType, metadata: loginEvents.metadata, createdAt: loginEvents.createdAt })
      .from(loginEvents)
      .where(eq(loginEvents.jobberAccountId, org.jobberAccountId))
      .orderBy(desc(loginEvents.createdAt))
      .limit(30),
    db
      .select()
      .from(orgNotes)
      .where(eq(orgNotes.orgId, org.id))
      .orderBy(desc(orgNotes.createdAt)),
  ]);

  res.json({
    id: org.id,
    jobberAccountId: org.jobberAccountId,
    displayName: org.name ?? org.lastKnownName ?? null,
    email: org.email,
    createdAt: org.createdAt,
    trialStartedAt: org.trialStartedAt,
    trialEndsAt: computeTrialEnd(org),
    subscriptionStatus: computeEffectiveStatus(org),
    disconnectedAt: org.disconnectedAt,
    expiresAt: org.expiresAt,
    updatedAt: org.updatedAt,
    stripeCustomerId: org.stripeCustomerId,
    stripeSubscriptionId: org.stripeSubscriptionId,
    assetIdentifierField: org.assetIdentifierField,
    tags: org.tags ?? [],
    activity: {
      assetCount: assetRow?.count ?? 0,
      clientCount: clientRow?.count ?? 0,
      jobCount: jobRow?.count ?? 0,
      lastLoginAt: lastLoginRow?.createdAt ?? null,
    },
    timeline,
    notes,
  });
});

// ---------- POST /api/admin/orgs/:id/notes ----------

router.post("/orgs/:id/notes", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { body } = req.body as { body?: string };
  if (!body?.trim()) { res.status(400).json({ error: "Note body is required" }); return; }

  const [org] = await db.select({ id: jobberOrgs.id }).from(jobberOrgs).where(eq(jobberOrgs.id, id)).limit(1);
  if (!org) { res.status(404).json({ error: "Org not found" }); return; }

  const [note] = await db
    .insert(orgNotes)
    .values({ id: crypto.randomUUID(), orgId: org.id, body: body.trim() })
    .returning();

  res.json({ ok: true, note });
});

// ---------- DELETE /api/admin/orgs/:id/notes/:noteId ----------

router.delete("/orgs/:id/notes/:noteId", async (req: Request, res: Response) => {
  const noteId = String(req.params.noteId);
  await db.delete(orgNotes).where(eq(orgNotes.id, noteId));
  res.json({ ok: true });
});

// ---------- PATCH /api/admin/orgs/:id/tags ----------

router.patch("/orgs/:id/tags", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { tags } = req.body as { tags?: string[] };
  if (!Array.isArray(tags)) { res.status(400).json({ error: "tags must be an array" }); return; }

  const validTags = tags.filter((t) => ALLOWED_TAGS.includes(t));

  await db.update(jobberOrgs).set({ tags: validTags, updatedAt: new Date() }).where(eq(jobberOrgs.id, id));
  res.json({ ok: true, tags: validTags });
});

// ---------- GET /api/admin/orgs/:id/reconcile-clients ----------
// Compares local client rows against Jobber's current client list.
// ?confirm=true to actually delete orphans (default is dry-run).

router.get("/orgs/:id/reconcile-clients", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const confirm = req.query.confirm === "true";

  const [org] = await db.select().from(jobberOrgs).where(eq(jobberOrgs.id, id)).limit(1);
  if (!org) { res.status(404).json({ error: "Org not found" }); return; }
  if (org.disconnectedAt) { res.status(409).json({ error: "Org is disconnected — cannot fetch Jobber client list" }); return; }

  // Fetch ALL current clients from Jobber (paginated)
  const accessToken = org.accessToken;
  const jobberClientIds = new Set<string>();
  let cursor: string | null = null;
  const PAGE_SIZE = 100;

  try {
    do {
      const body = JSON.stringify({
        query: `query($first: Int!, $after: String) {
          clients(first: $first, after: $after) {
            nodes { id }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        variables: { first: PAGE_SIZE, after: cursor },
      });
      const r = await fetch(JOBBER_GRAPHQL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, "X-JOBBER-GRAPHQL-VERSION": JOBBER_API_VERSION },
        body,
      });
      const json = (await r.json()) as { data?: { clients: { nodes: { id: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }; errors?: unknown[] };
      if (!r.ok || json.errors) { res.status(502).json({ error: "Jobber API error fetching clients", detail: json.errors }); return; }
      const page = json.data!.clients;
      for (const n of page.nodes) jobberClientIds.add(n.id);
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (cursor);
  } catch (err) {
    res.status(502).json({ error: `Jobber fetch failed: ${String(err)}` }); return;
  }

  // Find local clients for this org not in the Jobber response
  const localClients = await db
    .select({ id: clients.id, name: clients.name, jobberClientId: clients.jobberClientId, email: clients.email })
    .from(clients)
    .where(eq(clients.orgId, org.id));

  const orphaned = localClients.filter((c) => !jobberClientIds.has(c.jobberClientId));

  if (orphaned.length === 0) {
    res.json({ dryRun: !confirm, orphanedCount: 0, orphaned: [], message: "No orphaned clients found — local DB matches Jobber." });
    return;
  }

  if (!confirm) {
    // Dry-run: show what would be deleted
    const orphanedIds = orphaned.map((c) => c.jobberClientId);
    const assetRows = orphanedIds.length > 0
      ? await db.select({ jobberClientId: assets.jobberClientId, identifier: assets.identifier })
          .from(assets)
          .where(and(eq(assets.orgId, org.id), inArray(assets.jobberClientId, orphanedIds)))
      : [];

    res.json({
      dryRun: true,
      orphanedCount: orphaned.length,
      orphaned: orphaned.map((c) => ({
        ...c,
        affectedAssets: assetRows.filter((a) => a.jobberClientId === c.jobberClientId).map((a) => a.identifier),
      })),
      message: `${orphaned.length} orphaned client(s) found. Call with ?confirm=true to delete.`,
    });
    return;
  }

  // Confirmed — execute deletion
  const orphanedJobberClientIds = orphaned.map((c) => c.jobberClientId);

  // Null out jobberClientId on assets that referenced these clients (preserve the asset row)
  if (orphanedJobberClientIds.length > 0) {
    await db
      .update(assets)
      .set({ jobberClientId: null })
      .where(and(eq(assets.orgId, org.id), inArray(assets.jobberClientId, orphanedJobberClientIds)));
  }

  // Delete the orphaned client rows
  const orphanedInternalIds = orphaned.map((c) => c.id);
  await db.delete(clients).where(inArray(clients.id, orphanedInternalIds));

  console.log(`[admin/reconcile] deleted ${orphaned.length} orphaned client(s) for org ${org.id}`);
  res.json({
    dryRun: false,
    deleted: orphaned.length,
    deletedClients: orphaned.map((c) => ({ id: c.id, name: c.name, jobberClientId: c.jobberClientId })),
  });
});

// ---------- GET /api/admin/orgs/:id/reconcile-jobs ----------
// Compares local job rows against Jobber's current job list.
// ?confirm=true to actually delete orphans (default is dry-run).

router.get("/orgs/:id/reconcile-jobs", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const confirm = req.query.confirm === "true";

  const [org] = await db.select().from(jobberOrgs).where(eq(jobberOrgs.id, id)).limit(1);
  if (!org) { res.status(404).json({ error: "Org not found" }); return; }
  if (org.disconnectedAt) { res.status(409).json({ error: "Org is disconnected — cannot fetch Jobber job list" }); return; }

  // Fetch ALL current job IDs from Jobber (paginated)
  const accessToken = org.accessToken;
  const jobberJobIds = new Set<string>();
  let cursor: string | null = null;
  const PAGE_SIZE = 100;

  try {
    do {
      const body = JSON.stringify({
        query: `query($first: Int!, $after: String) {
          jobs(first: $first, after: $after) {
            nodes { id }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        variables: { first: PAGE_SIZE, after: cursor },
      });
      const r = await fetch(JOBBER_GRAPHQL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, "X-JOBBER-GRAPHQL-VERSION": JOBBER_API_VERSION },
        body,
      });
      const json = (await r.json()) as { data?: { jobs: { nodes: { id: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }; errors?: unknown[] };
      if (!r.ok || json.errors) { res.status(502).json({ error: "Jobber API error fetching jobs", detail: json.errors }); return; }
      const page = json.data!.jobs;
      for (const n of page.nodes) jobberJobIds.add(n.id);
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (cursor);
  } catch (err) {
    res.status(502).json({ error: `Jobber fetch failed: ${String(err)}` }); return;
  }

  // Find local jobs for this org not in the Jobber response
  const localJobs = await db
    .select({ id: jobs.id, jobberJobId: jobs.jobberJobId, title: jobs.title, jobNumber: jobs.jobNumber, jobStatus: jobs.jobStatus, jobberClientId: jobs.jobberClientId, createdAt: jobs.createdAt })
    .from(jobs)
    .where(eq(jobs.orgId, org.id));

  const orphaned = localJobs.filter((j) => !jobberJobIds.has(j.jobberJobId));

  if (orphaned.length === 0) {
    res.json({ dryRun: !confirm, orphanedCount: 0, orphaned: [], message: "No orphaned jobs found — local DB matches Jobber." });
    return;
  }

  if (!confirm) {
    res.json({
      dryRun: true,
      orphanedCount: orphaned.length,
      orphaned: orphaned.map((j) => ({
        id: j.id,
        jobberJobId: j.jobberJobId,
        jobNumber: j.jobNumber,
        title: j.title,
        jobStatus: j.jobStatus,
        jobberClientId: j.jobberClientId,
        createdAt: j.createdAt,
      })),
      message: `${orphaned.length} orphaned job(s) found. Call with ?confirm=true to delete (also deletes their custom fields and line items). Run a sync afterward to update asset job counts.`,
    });
    return;
  }

  // Confirmed — delete orphaned jobs and their child records
  const orphanedInternalIds = orphaned.map((j) => j.id);
  await db.delete(jobCustomFields).where(inArray(jobCustomFields.jobId, orphanedInternalIds));
  await db.delete(jobLineItems).where(inArray(jobLineItems.jobId, orphanedInternalIds));
  await db.delete(jobs).where(inArray(jobs.id, orphanedInternalIds));

  console.log(`[admin/reconcile] deleted ${orphaned.length} orphaned job(s) for org ${org.id}`);
  res.json({
    dryRun: false,
    deleted: orphaned.length,
    deletedJobs: orphaned.map((j) => ({ id: j.id, jobberJobId: j.jobberJobId, jobNumber: j.jobNumber, title: j.title })),
    note: "Run a sync for this org to update asset job counts.",
  });
});

// ---------- POST /api/admin/orgs/:id/force-refresh-token ----------

router.post("/orgs/:id/force-refresh-token", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const [org] = await db.select({ jobberAccountId: jobberOrgs.jobberAccountId, disconnectedAt: jobberOrgs.disconnectedAt }).from(jobberOrgs).where(eq(jobberOrgs.id, id)).limit(1);
  if (!org) { res.status(404).json({ error: "Org not found" }); return; }
  if (org.disconnectedAt) { res.status(409).json({ error: "Org is disconnected — cannot refresh token" }); return; }

  try {
    await forceRefreshToken(org.jobberAccountId);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

export default router;
