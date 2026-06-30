import { Router, Request, Response } from "express";
import { db } from "../db/client";
import { jobberOrgs } from "../db/schema";
import { eq } from "drizzle-orm";
import { isValidPin, hashPin, verifyPin } from "../lib/pin";

const router = Router();

// Per-account brute-force lockout (in addition to the per-IP rate limiter).
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60 * 1000;

async function getOrg(jobberAccountId: string) {
  const rows = await db
    .select()
    .from(jobberOrgs)
    .where(eq(jobberOrgs.jobberAccountId, jobberAccountId))
    .limit(1);
  return rows[0] ?? null;
}

// ---------- GET /api/pin/status ----------
router.get("/status", async (req: Request, res: Response) => {
  const { jobberAccountId } = req.query;
  if (!jobberAccountId || typeof jobberAccountId !== "string") {
    res.status(400).json({ error: "Missing required query param: jobberAccountId" });
    return;
  }
  const org = await getOrg(jobberAccountId);
  if (!org) {
    res.status(404).json({ error: "Org not found" });
    return;
  }
  res.json({ pinSet: Boolean(org.pinHash) });
});

// ---------- POST /api/pin/set ----------
// Allowed only when no PIN exists yet (first connect, or after a Forgot-PIN
// OAuth reset cleared the hash). Existing PINs cannot be silently overwritten.
router.post("/set", async (req: Request, res: Response) => {
  const { jobberAccountId, pin } = req.body as { jobberAccountId?: string; pin?: string };
  if (!jobberAccountId) {
    res.status(400).json({ error: "Missing required body param: jobberAccountId" });
    return;
  }
  if (!isValidPin(pin)) {
    res.status(400).json({ error: "PIN must be 4–6 digits" });
    return;
  }
  const org = await getOrg(jobberAccountId);
  if (!org) {
    res.status(404).json({ error: "Org not found" });
    return;
  }
  if (org.pinHash) {
    res.status(409).json({ error: "A PIN is already set. Use Forgot PIN to reset it." });
    return;
  }
  await db
    .update(jobberOrgs)
    .set({
      pinHash: hashPin(pin),
      pinSetAt: new Date(),
      pinFailedAttempts: 0,
      pinLockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(jobberOrgs.jobberAccountId, jobberAccountId));
  res.json({ ok: true });
});

// ---------- POST /api/pin/verify ----------
router.post("/verify", async (req: Request, res: Response) => {
  const { jobberAccountId, pin } = req.body as { jobberAccountId?: string; pin?: string };
  if (!jobberAccountId || typeof pin !== "string") {
    res.status(400).json({ error: "Missing required body params: jobberAccountId, pin" });
    return;
  }
  const org = await getOrg(jobberAccountId);
  if (!org || !org.pinHash) {
    res.status(404).json({ error: "No PIN set for this account" });
    return;
  }

  const now = Date.now();
  if (org.pinLockedUntil && org.pinLockedUntil.getTime() > now) {
    res.status(429).json({
      ok: false,
      lockedUntil: org.pinLockedUntil.toISOString(),
    });
    return;
  }

  if (verifyPin(pin, org.pinHash)) {
    await db
      .update(jobberOrgs)
      .set({ pinFailedAttempts: 0, pinLockedUntil: null, updatedAt: new Date() })
      .where(eq(jobberOrgs.jobberAccountId, jobberAccountId));
    res.json({ ok: true });
    return;
  }

  const attempts = org.pinFailedAttempts + 1;
  const locked = attempts >= MAX_ATTEMPTS;
  await db
    .update(jobberOrgs)
    .set({
      pinFailedAttempts: locked ? 0 : attempts,
      pinLockedUntil: locked ? new Date(now + LOCKOUT_MS) : null,
      updatedAt: new Date(),
    })
    .where(eq(jobberOrgs.jobberAccountId, jobberAccountId));

  res.status(401).json({
    ok: false,
    attemptsLeft: locked ? 0 : MAX_ATTEMPTS - attempts,
    lockedUntil: locked ? new Date(now + LOCKOUT_MS).toISOString() : undefined,
  });
});

export default router;
