import { Request, Response, NextFunction } from "express";
import { resolveSession, SESSION_COOKIE } from "../lib/session";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Account id derived from a valid session cookie (undefined if none). */
      sessionAccountId?: string;
      /** Resolved account id for this request: session cookie only. */
      accountId?: string;
    }
  }
}

/**
 * Populate req.sessionAccountId and req.accountId from the session cookie.
 * The legacy jobberAccountId query/body param is no longer trusted — identity
 * is session-derived only. requireAuth rejects requests with no session when
 * AUTH_ENFORCE=true.
 */
export async function resolveAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (token) {
      const s = await resolveSession(token);
      if (s) req.sessionAccountId = s.jobberAccountId;
    }
  } catch {
    // cookie unreadable — req.accountId stays undefined
  }
  req.accountId = req.sessionAccountId;
  next();
}

/**
 * Route guard. During the permissive window (AUTH_ENFORCE unset) it passes
 * everything through. Once AUTH_ENFORCE=true, requests without a valid session
 * cookie are rejected — the legacy param is no longer trusted.
 */
// Session-less, client-portal-facing reads (UUID-capability URLs). These stay
// public so the magic-link portal keeps working once enforcement is on.
// req.path is relative to the /api mount (e.g. "/portal/abc", "/jobs/x/pdf").
function isPublicPortalPath(req: Request): boolean {
  if (req.path.startsWith("/portal/")) return true;
  if (req.method !== "GET") return false;
  return /^\/assets\/[^/]+\/jobs$/.test(req.path) || /^\/jobs\/[^/]+\/pdf$/.test(req.path);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (isPublicPortalPath(req)) return next();
  if (req.sessionAccountId) return next();
  if (process.env.AUTH_ENFORCE === "true") {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}
