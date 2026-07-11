import { Router, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { jobberOrgs } from "../db/schema";
import { isValidPassword, hashPassword, verifyPassword } from "../lib/password";
import {
  createSession,
  destroySession,
  destroyAllSessions,
  resolveSession,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "../lib/session";
import { createResetToken, consumeResetToken } from "../lib/passwordReset";
import { sendPasswordResetEmail } from "../lib/mailer";

const router = Router();

function reqMeta(req: Request) {
  return { userAgent: req.get("user-agent") ?? null, ip: req.ip ?? null };
}

async function getOrg(jobberAccountId: string) {
  const [org] = await db
    .select()
    .from(jobberOrgs)
    .where(eq(jobberOrgs.jobberAccountId, jobberAccountId))
    .limit(1);
  return org ?? null;
}

/** Clear-cookie must mirror the set-cookie attributes (minus maxAge) or the browser won't remove it. */
function clearSessionCookie(res: Response) {
  const { httpOnly, secure, sameSite, path, domain } = sessionCookieOptions();
  res.clearCookie(SESSION_COOKIE, { httpOnly, secure, sameSite, path, domain });
}

// ---------- POST /auth/set-password ----------
// First-time setup during onboarding. Requires the session issued by the OAuth
// callback (which only issues one when the account has no password yet), so the
// account is derived from the cookie — never from a client-supplied id. Allowed
// only when no password exists. The OAuth session stays active on success.
router.post("/set-password", async (req: Request, res: Response) => {
  const { password } = req.body as { password?: string };

  const cookieToken = req.cookies?.[SESSION_COOKIE] as string | undefined;
  const session = cookieToken ? await resolveSession(cookieToken) : null;
  if (!session) {
    res.status(401).json({ error: "Not authenticated. Reconnect with Jobber to set a password." });
    return;
  }
  if (!isValidPassword(password)) {
    res.status(400).json({ error: "Password must be 8–200 characters" });
    return;
  }

  const jobberAccountId = session.jobberAccountId;
  const org = await getOrg(jobberAccountId);
  if (!org) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  if (org.passwordHash) {
    res.status(409).json({ error: "A password is already set. Log in or reset it instead." });
    return;
  }

  await db
    .update(jobberOrgs)
    .set({ passwordHash: await hashPassword(password), passwordSetAt: new Date(), updatedAt: new Date() })
    .where(eq(jobberOrgs.jobberAccountId, jobberAccountId));

  res.json({ ok: true, jobberAccountId, email: org.email, name: org.name });
});

// ---------- POST /auth/login ----------
router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Missing required body params: email, password" });
    return;
  }
  const normEmail = email.trim().toLowerCase();
  const [org] = await db
    .select()
    .from(jobberOrgs)
    .where(eq(jobberOrgs.email, normEmail))
    .limit(1);

  // Always run a verify (even with no match) to keep timing uniform and avoid
  // leaking which emails exist.
  const ok = await verifyPassword(org?.passwordHash ?? null, password);
  if (!org || !ok) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const { token } = await createSession(org.jobberAccountId, reqMeta(req));
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  res.json({ ok: true, jobberAccountId: org.jobberAccountId, email: org.email, name: org.name });
});

// ---------- POST /auth/forgot-password ----------
// Always responds 200 regardless of whether the email exists — no enumeration.
router.post("/forgot-password", async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };
  if (typeof email === "string" && email.trim()) {
    const normEmail = email.trim().toLowerCase();
    const [org] = await db
      .select()
      .from(jobberOrgs)
      .where(eq(jobberOrgs.email, normEmail))
      .limit(1);
    // Only send when the account exists and actually has a password to reset.
    if (org?.email && org.passwordHash) {
      try {
        const token = await createResetToken(org.jobberAccountId);
        const base = process.env.APP_BASE_URL ?? process.env.FRONTEND_URL ?? "http://localhost:3000";
        const url = `${base}/#/reset?token=${encodeURIComponent(token)}`;
        await sendPasswordResetEmail(org.email, url);
      } catch (err) {
        console.error("[forgot-password] failed to issue/send reset:", String(err));
      }
    }
  }
  res.json({ ok: true });
});

// ---------- POST /auth/reset-password ----------
router.post("/reset-password", async (req: Request, res: Response) => {
  const { token, password } = req.body as { token?: string; password?: string };
  if (typeof token !== "string" || !token) {
    res.status(400).json({ error: "Missing reset token" });
    return;
  }
  if (!isValidPassword(password)) {
    res.status(400).json({ error: "Password must be 8–200 characters" });
    return;
  }

  const jobberAccountId = await consumeResetToken(token);
  if (!jobberAccountId) {
    res.status(400).json({ error: "This reset link is invalid or has expired." });
    return;
  }

  await db
    .update(jobberOrgs)
    .set({ passwordHash: await hashPassword(password), passwordSetAt: new Date(), updatedAt: new Date() })
    .where(eq(jobberOrgs.jobberAccountId, jobberAccountId));

  // Invalidate every existing session, then log in this device fresh.
  await destroyAllSessions(jobberAccountId);
  const org = await getOrg(jobberAccountId);
  const { token: sessionToken } = await createSession(jobberAccountId, reqMeta(req));
  res.cookie(SESSION_COOKIE, sessionToken, sessionCookieOptions());
  res.json({ ok: true, jobberAccountId, email: org?.email, name: org?.name });
});

// ---------- POST /auth/logout ----------
router.post("/logout", async (req: Request, res: Response) => {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (token) await destroySession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ---------- GET /auth/session ----------
// Current auth state for the frontend guard.
router.get("/session", async (req: Request, res: Response) => {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) {
    res.json({ authenticated: false });
    return;
  }
  const s = await resolveSession(token);
  if (!s) {
    clearSessionCookie(res);
    res.json({ authenticated: false });
    return;
  }
  const org = await getOrg(s.jobberAccountId);
  if (!org) {
    res.json({ authenticated: false });
    return;
  }
  res.json({
    authenticated: true,
    jobberAccountId: org.jobberAccountId,
    email: org.email,
    name: org.name,
    passwordSet: Boolean(org.passwordHash),
    subscriptionStatus: org.subscriptionStatus,
  });
});

export default router;
