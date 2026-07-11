import crypto from "crypto";
import { eq } from "drizzle-orm";
import type { CookieOptions } from "express";
import { db } from "../db/client";
import { sessions } from "../db/schema";

/** 30-day sliding window: expiry extends on each authenticated request. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = "am_session";

/** We store only a hash of the cookie token, never the raw token. */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Cookie attributes. Cross-site in prod (minderapps.io → onrender.com) needs SameSite=None; Secure. */
export function sessionCookieOptions(): CookieOptions {
  const prod = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: prod,
    sameSite: prod ? "none" : "lax",
    path: "/",
    maxAge: SESSION_TTL_MS,
  };
}

export async function createSession(
  jobberAccountId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {}
): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    id: crypto.randomUUID(),
    tokenHash: hashToken(token),
    jobberAccountId,
    userAgent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
    createdAt: now,
    lastUsedAt: now,
    expiresAt,
  });
  return { token, expiresAt };
}

/** Resolve a raw cookie token to its session, applying sliding renewal. Returns null if invalid/expired. */
export async function resolveSession(token: string) {
  const [s] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);
  if (!s) return null;

  if (s.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, s.id));
    return null;
  }

  const now = new Date();
  await db
    .update(sessions)
    .set({ lastUsedAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
    .where(eq(sessions.id, s.id));
  return s;
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** Invalidate every session for an account (used on password reset). */
export async function destroyAllSessions(jobberAccountId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.jobberAccountId, jobberAccountId));
}
