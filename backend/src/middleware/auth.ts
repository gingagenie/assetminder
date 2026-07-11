import { Request, Response, NextFunction } from "express";
import { resolveSession, SESSION_COOKIE } from "../lib/session";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Account id derived from a valid session cookie (undefined if none). */
      sessionAccountId?: string;
      /** Resolved account id for this request: session cookie, else the legacy param. */
      accountId?: string;
    }
  }
}

/**
 * Populate req.sessionAccountId (from the session cookie) and req.accountId
 * (session, falling back to the legacy jobberAccountId query/body param).
 *
 * PERMISSIVE by design: never rejects. This lets the cookie switch roll out
 * while old param-based clients keep working. Enforcement is added by
 * requireAuth once AUTH_ENFORCE=true.
 */
export async function resolveAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (token) {
      const s = await resolveSession(token);
      if (s) req.sessionAccountId = s.jobberAccountId;
    }
  } catch {
    // fall through to the legacy param
  }
  req.accountId =
    req.sessionAccountId ??
    (req.query.jobberAccountId as string | undefined) ??
    (req.body as { jobberAccountId?: string } | undefined)?.jobberAccountId;
  next();
}

/**
 * Route guard. During the permissive window (AUTH_ENFORCE unset) it passes
 * everything through. Once AUTH_ENFORCE=true, requests without a valid session
 * cookie are rejected — the legacy param is no longer trusted.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.sessionAccountId) return next();
  if (process.env.AUTH_ENFORCE === "true") {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}
