import { Router, Request, Response } from "express";
import crypto from "crypto";
import { syncOrg } from "../lib/sync";
import { groupAssets } from "../lib/groupAssets";
import { calculateDueDates } from "../lib/calculateDueDates";

const router = Router();

interface JobberWebhookPayload {
  topic: string;
  accountId: string;
  data?: unknown;
}

// Raw body is captured by the express.json({ verify }) callback in index.ts
// and stored on req.rawBody, so we don't need route-level express.raw() here.
router.post("/jobber", (req: Request, res: Response) => {
  const secret = process.env.JOBBER_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[webhook] JOBBER_WEBHOOK_SECRET not set");
    res.status(500).json({ error: "Webhook secret not configured" });
    return;
  }

  const signature = req.headers["x-jobber-hmac-sha256"];
  if (!signature || typeof signature !== "string") {
    res.status(401).json({ error: "Missing X-Jobber-Hmac-SHA256 header" });
    return;
  }

  const rawBody = req.rawBody;
  if (!rawBody) {
    console.error("[webhook] rawBody not available — verify callback may not be running");
    res.status(500).json({ error: "Raw body unavailable" });
    return;
  }

  // Verify HMAC-SHA256 using the raw request bytes
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);

  const valid =
    expectedBuf.length === signatureBuf.length &&
    crypto.timingSafeEqual(expectedBuf, signatureBuf);

  if (!valid) {
    console.warn(
      `[webhook] invalid HMAC — received="${signature}" expected="${expected}"`
    );
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  // req.body is already parsed JSON by express.json()
  const payload = req.body as JobberWebhookPayload;
  const { topic, accountId } = payload;

  if (!["JOB_CREATE", "JOB_UPDATE"].includes(topic)) {
    res.status(200).json({ ok: true, skipped: true, topic });
    return;
  }

  if (!accountId) {
    res.status(400).json({ error: "Missing accountId in payload" });
    return;
  }

  // Respond immediately — Jobber requires a response within 1 second
  res.status(200).json({ ok: true });

  // Run the full sync pipeline async after responding
  setImmediate(async () => {
    console.log(`[webhook] ${topic} for accountId=${accountId} — starting pipeline`);
    try {
      await syncOrg(accountId);
      console.log(`[webhook] sync complete for ${accountId}`);

      await groupAssets(accountId);
      console.log(`[webhook] group-assets complete for ${accountId}`);

      await calculateDueDates(accountId);
      console.log(`[webhook] calculate-due-dates complete for ${accountId}`);

      console.log(`[webhook] pipeline complete for accountId=${accountId}`);
    } catch (err) {
      console.error(`[webhook] pipeline failed for accountId=${accountId}:`, err);
    }
  });
});

export default router;
