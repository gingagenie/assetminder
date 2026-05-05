import { Router, Request, Response, NextFunction } from "express";
import { db } from "../db/client";
import { jobberOrgs } from "../db/schema";
import { eq, sql } from "drizzle-orm";
import { deleteOrgData } from "../lib/deleteOrg";

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

  const enriched = orgs.map((org) => ({
    id: org.id,
    jobberAccountId: org.jobberAccountId,
    createdAt: org.createdAt,
    trialStartedAt: org.trialStartedAt,
    trialEndsAt: computeTrialEnd(org),
    subscriptionStatus: computeEffectiveStatus(org),
    stripeCustomerId: org.stripeCustomerId,
    stripeSubscriptionId: org.stripeSubscriptionId,
    assetIdentifierField: org.assetIdentifierField,
  }));

  const total = enriched.length;
  const active = enriched.filter((o) => o.subscriptionStatus === "active").length;
  const trial = enriched.filter((o) => o.subscriptionStatus === "trial").length;
  const expired = enriched.filter((o) => o.subscriptionStatus === "expired").length;
  const mrr = active * MRR_PER_ACTIVE;

  res.json({ stats: { total, active, trial, expired, mrr }, orgs: enriched });
});

// ---------- POST /api/admin/orgs/:id/extend-trial ----------

router.post("/orgs/:id/extend-trial", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const [org] = await db.select().from(jobberOrgs).where(eq(jobberOrgs.id, id)).limit(1);
  if (!org) { res.status(404).json({ error: "Org not found" }); return; }

  const currentStart = org.trialStartedAt ?? org.createdAt;
  const newStart = new Date(currentStart.getTime() + 14 * 24 * 60 * 60 * 1000);

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

// ---------- DELETE /api/admin/orgs/:id ----------

router.delete("/orgs/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const [org] = await db.select().from(jobberOrgs).where(eq(jobberOrgs.id, id)).limit(1);
  if (!org) { res.status(404).json({ error: "Org not found" }); return; }

  await deleteOrgData(org.jobberAccountId);
  res.json({ ok: true });
});

export default router;
