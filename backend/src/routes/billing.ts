import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { db } from "../db/client";
import { jobberOrgs } from "../db/schema";
import { eq } from "drizzle-orm";

const router = Router();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stripe = new (Stripe as any)(process.env.STRIPE_SECRET_KEY!);
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;
const PRICE_ID = process.env.STRIPE_PRICE_ID!;

// POST /api/billing/create-checkout-session
router.post("/create-checkout-session", async (req: Request, res: Response) => {
  const { jobberAccountId } = req.body as { jobberAccountId?: string };
  if (!jobberAccountId) {
    res.status(400).json({ error: "jobberAccountId required" });
    return;
  }

  const [org] = await db
    .select()
    .from(jobberOrgs)
    .where(eq(jobberOrgs.jobberAccountId, jobberAccountId))
    .limit(1);

  if (!org) {
    res.status(404).json({ error: "Org not found" });
    return;
  }

  // Get or create Stripe customer
  let customerId = org.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      metadata: { jobberAccountId },
    });
    customerId = customer.id;
    await db
      .update(jobberOrgs)
      .set({ stripeCustomerId: customerId, updatedAt: new Date() })
      .where(eq(jobberOrgs.jobberAccountId, jobberAccountId));
  }

  const frontendBase = process.env.FRONTEND_URL ?? "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: PRICE_ID, quantity: 1 }],
    subscription_data: { trial_period_days: 14 },
    success_url: `${frontendBase}/#/dashboard`,
    cancel_url: `${frontendBase}/#/dashboard`,
  });

  res.json({ url: session.url });
});

// POST /api/billing/webhook
// Raw body required — applied in index.ts before express.json()
router.post("/webhook", async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"];
  if (!sig) {
    res.status(400).json({ error: "Missing stripe-signature header" });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: any;
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error("[billing/webhook] Signature verification failed:", String(err));
    res.status(400).json({ error: "Webhook signature invalid" });
    return;
  }

  console.log(`[billing/webhook] Event: ${event.type}`);

  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
    const sub = event.data.object;
    if (sub.status === "active" || sub.status === "trialing") {
      await db
        .update(jobberOrgs)
        .set({ subscriptionStatus: "active", stripeSubscriptionId: sub.id, updatedAt: new Date() })
        .where(eq(jobberOrgs.stripeCustomerId, sub.customer as string));
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object;
    await db
      .update(jobberOrgs)
      .set({ subscriptionStatus: "expired", updatedAt: new Date() })
      .where(eq(jobberOrgs.stripeCustomerId, sub.customer as string));
  }

  res.json({ received: true });
});

// GET /api/billing/status — NOT behind subscription middleware, safe to call from expired orgs
router.get("/status", async (req: Request, res: Response) => {
  const { jobberAccountId } = req.query as { jobberAccountId?: string };
  if (!jobberAccountId) {
    res.status(400).json({ error: "jobberAccountId required" });
    return;
  }

  const [org] = await db
    .select()
    .from(jobberOrgs)
    .where(eq(jobberOrgs.jobberAccountId, jobberAccountId))
    .limit(1);

  if (!org) {
    res.status(404).json({ error: "Org not found" });
    return;
  }

  const trialStart = org.trialStartedAt ?? org.createdAt;
  const trialEndMs = trialStart.getTime() + 14 * 24 * 60 * 60 * 1000;
  const msLeft = trialEndMs - Date.now();
  const trialDaysLeft = Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
  const trialExpired = org.subscriptionStatus !== "active" && msLeft <= 0;

  // Persist expiry if we just detected it
  if (trialExpired && org.subscriptionStatus === "trial") {
    await db
      .update(jobberOrgs)
      .set({ subscriptionStatus: "expired", updatedAt: new Date() })
      .where(eq(jobberOrgs.id, org.id));
  }

  res.json({
    subscriptionStatus: trialExpired ? "expired" : org.subscriptionStatus,
    trialDaysLeft,
    trialExpired,
  });
});

// GET /api/billing/portal-url
router.get("/portal-url", async (req: Request, res: Response) => {
  const { jobberAccountId } = req.query as { jobberAccountId?: string };
  if (!jobberAccountId) {
    res.status(400).json({ error: "jobberAccountId required" });
    return;
  }

  const [org] = await db
    .select()
    .from(jobberOrgs)
    .where(eq(jobberOrgs.jobberAccountId, jobberAccountId))
    .limit(1);

  if (!org || !org.stripeCustomerId) {
    res.status(404).json({ error: "No billing account found" });
    return;
  }

  const frontendBase = process.env.FRONTEND_URL ?? "http://localhost:3000";
  const session = await stripe.billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: `${frontendBase}/#/dashboard`,
  });

  res.json({ url: session.url });
});

export default router;
