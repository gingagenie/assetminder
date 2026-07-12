import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { eq } from "drizzle-orm";
import authRouter from "./routes/auth";
import apiRouter from "./routes/api";
import webhookRouter from "./routes/webhooks";
import billingRouter from "./routes/billing";
import adminRouter from "./routes/admin";
import accountAuthRouter from "./routes/accountAuth";
import { resolveAuth, requireAuth } from "./middleware/auth";
import { db } from "./db/client";
import { jobberOrgs } from "./db/schema";

const app = express();
const PORT = process.env.PORT ?? 3001;

const allowedOrigins = [
  "http://localhost:3000",
  "https://minderapps.io",
  "https://www.minderapps.io",
  "https://api.minderapps.io",
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

app.set("trust proxy", 1);
app.use(cors({ origin: allowedOrigins, credentials: true }));

// Raw body capture for webhook HMAC — MUST be before express.json()
app.use("/api/webhooks/jobber", express.raw({ type: "application/json" }));
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));

app.use(express.json());
app.use(cookieParser());

// Resolve auth for every /api route: sets req.sessionAccountId and req.accountId from the session cookie.
app.use("/api", resolveAuth);

// Rate limiting — sync is the most expensive operation
const syncLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  limit: 5,                  // max 5 syncs per 5 minutes per IP
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many sync requests. Please wait before syncing again." },
});
app.use("/api/sync", syncLimiter);

// Login is a credential-guessing target — throttle per IP.
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 10,           // max 10 login attempts per minute per IP
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait a moment." },
});
app.use("/auth/login", loginLimiter);

// Reset endpoints — throttle to prevent email bombing / token probing per IP.
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,                 // max 10 reset requests per 15 min per IP
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many password reset requests. Please wait a while." },
});
app.use("/auth/forgot-password", resetLimiter);
app.use("/auth/reset-password", resetLimiter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth/jobber", authRouter);
app.use("/auth", accountAuthRouter); // /auth/login, /auth/logout, /auth/session, /auth/set-password
app.use("/api/webhooks", webhookRouter); // must be before /api to avoid express.json() conflict
app.use("/api/billing", billingRouter);  // not behind subscription check
app.use("/api/admin", adminRouter);      // key-protected, not behind subscription check

// Subscription middleware — checks trial/active/expired for all /api/* routes
async function requireSubscription(req: Request, res: Response, next: NextFunction) {
  // Allow disconnect regardless of subscription status
  if (req.path === "/disconnect") return next();

  const jobberAccountId = req.accountId;

  if (!jobberAccountId) return next(); // let the route handler deal with missing auth

  const [org] = await db
    .select()
    .from(jobberOrgs)
    .where(eq(jobberOrgs.jobberAccountId, jobberAccountId))
    .limit(1);

  if (!org) return next(); // let the route handler return 404

  // If already marked active, allow
  if (org.subscriptionStatus === "active") return next();

  // If trial, check whether 14 days have elapsed
  if (org.subscriptionStatus === "trial") {
    const trialStart = org.trialStartedAt ?? org.createdAt;
    const trialEndMs = trialStart.getTime() + 14 * 24 * 60 * 60 * 1000;
    if (Date.now() <= trialEndMs) return next();

    // Trial expired — persist the new status
    await db
      .update(jobberOrgs)
      .set({ subscriptionStatus: "expired", updatedAt: new Date() })
      .where(eq(jobberOrgs.id, org.id));

    res.status(402).json({ error: "subscription_required" });
    return;
  }

  // Already expired
  res.status(402).json({ error: "subscription_required" });
}

app.use("/api", requireAuth, requireSubscription, apiRouter);

app.listen(PORT, () => {
  console.log(`AssetMinder backend running on port ${PORT}`);
});
