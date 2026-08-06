import { Router, Request, Response, NextFunction } from "express";
import { db } from "../db/client";
import { jobberOrgs, loginEvents, clients, assets, jobs, orgNotes } from "../db/schema";
import { eq, sql, desc } from "drizzle-orm";
import { deleteOrgData } from "../lib/deleteOrg";
import { forceRefreshToken } from "../lib/jobberToken";
import crypto from "crypto";

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
      .select({ id: loginEvents.id, eventType: loginEvents.eventType, createdAt: loginEvents.createdAt })
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
