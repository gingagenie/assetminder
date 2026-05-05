import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { eq } from "drizzle-orm";
import authRouter from "./routes/auth";
import apiRouter from "./routes/api";
import webhookRouter from "./routes/webhooks";
import billingRouter from "./routes/billing";
import { db } from "./db/client";
import { jobberOrgs } from "./db/schema";

const app = express();
const PORT = process.env.PORT ?? 3001;

const allowedOrigins = [
  "http://localhost:3000",
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

app.set("trust proxy", 1);
app.use(cors({ origin: allowedOrigins, credentials: true }));

// Raw body capture for webhook HMAC — MUST be before express.json()
app.use("/api/webhooks/jobber", express.raw({ type: "application/json" }));
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));

app.use(express.json());

// Rate limiting — sync is the most expensive operation
const syncLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  limit: 5,                  // max 5 syncs per 5 minutes per IP
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many sync requests. Please wait before syncing again." },
});
app.use("/api/sync", syncLimiter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth/jobber", authRouter);
app.use("/api/webhooks", webhookRouter); // must be before /api to avoid express.json() conflict
app.use("/api/billing", billingRouter);  // not behind subscription check

// Subscription middleware — checks trial/active/expired for all /api/* routes
async function requireSubscription(req: Request, res: Response, next: NextFunction) {
  // Allow disconnect regardless of subscription status
  if (req.path === "/disconnect") return next();

  const jobberAccountId =
    (req.query.jobberAccountId as string | undefined) ??
    (req.body as { jobberAccountId?: string } | undefined)?.jobberAccountId;

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

app.use("/api", requireSubscription, apiRouter);

app.listen(PORT, () => {
  console.log(`AssetMinder backend running on port ${PORT}`);
});
