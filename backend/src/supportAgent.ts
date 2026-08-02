import "dotenv/config";
import { randomUUID } from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "./db/client";
import { smSupportEmails } from "./db/schema";
import { fetchUnseenEmails } from "./lib/supportAgent/imap";
import { classifyEmail } from "./lib/supportAgent/classify";
import { sendReply } from "./lib/supportAgent/smtpReply";
import { notifyFlagged } from "./lib/supportAgent/notify";
import { sendDigest } from "./lib/supportAgent/digest";

// ── config ────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = Number(process.env.SUPPORT_POLL_INTERVAL_MS ?? 3 * 60 * 1000);
const CONFIDENCE_THRESHOLD = Number(process.env.SUPPORT_CONFIDENCE_THRESHOLD ?? 0.85);
const DIGEST_HOUR = Number(process.env.SUPPORT_DIGEST_HOUR ?? 8);

// ── hard-block keywords ───────────────────────────────────────────────────────
// These prevent auto-reply regardless of confidence — always flag for human review.

const HARD_BLOCK_KEYWORDS = [
  "refund",
  "cancel",
  "cancellation",
  "bug",
  "broken",
  "charge",
  "chargeback",
  "dispute",
  "scam",
  "fraud",
  "legal",
  "lawyer",
];

function hasHardBlockKeyword(subject: string, body: string): boolean {
  const text = `${subject} ${body}`.toLowerCase();
  return HARD_BLOCK_KEYWORDS.some((kw) => text.includes(kw));
}

// ── daily digest ──────────────────────────────────────────────────────────────

let lastDigestDate = "";

async function maybeSendDigest(): Promise<void> {
  const now = new Date();
  if (now.getHours() < DIGEST_HOUR) return;

  const today = now.toISOString().split("T")[0];
  if (lastDigestDate === today) return;

  lastDigestDate = today;
  try {
    await sendDigest();
  } catch (err) {
    console.error("[support-agent] Daily digest failed:", err);
  }
}

// ── main poll loop ────────────────────────────────────────────────────────────

async function pollAndProcess(): Promise<void> {
  console.log("[support-agent] Polling for new emails...");

  const emails = await fetchUnseenEmails();

  if (emails.length === 0) {
    console.log("[support-agent] No new emails.");
    return;
  }

  console.log(`[support-agent] Found ${emails.length} unread email(s).`);

  for (const email of emails) {
    try {
      // Deduplicate via message_id
      if (email.messageId) {
        const existing = await db
          .select({ id: smSupportEmails.id })
          .from(smSupportEmails)
          .where(eq(smSupportEmails.messageId, email.messageId))
          .limit(1);

        if (existing.length > 0) {
          console.log(`[support-agent] Skipping duplicate messageId=${email.messageId}`);
          continue;
        }
      }

      const hardBlocked = hasHardBlockKeyword(email.subject, email.body);

      // Classify with Claude (even hard-blocked emails — gives us a category for logging)
      let category: string | null = null;
      let confidence: number | null = null;
      let draftReply: string | null = null;
      let tone: string | null = null;

      try {
        const result = await classifyEmail(email.fromEmail, email.subject, email.body);
        category = result.category;
        confidence = result.confidence;
        draftReply = result.draft_reply;
        tone = result.tone;
      } catch (classifyErr) {
        console.error("[support-agent] Classification failed for", email.fromEmail, classifyErr);
        // Fall through: flag without classification data
      }

      const id = randomUUID();
      const bodyTruncated = email.body.slice(0, 10_000);

      // Decision gate
      const shouldAutoReply =
        !hardBlocked &&
        confidence != null &&
        confidence >= CONFIDENCE_THRESHOLD &&
        tone !== "frustrated" &&
        tone !== "urgent";

      if (shouldAutoReply && draftReply) {
        try {
          await sendReply(email.fromEmail, email.subject, draftReply, email.messageId);

          await db.insert(smSupportEmails).values({
            id,
            fromEmail: email.fromEmail,
            subject: email.subject,
            body: bodyTruncated,
            category,
            confidence: confidence != null ? String(confidence) : null,
            draftReply,
            status: "auto_replied",
            messageId: email.messageId,
          });

          console.log(
            `[support-agent] Auto-replied to ${email.fromEmail} (${category}, confidence=${confidence?.toFixed(2)})`,
          );
        } catch (replyErr) {
          console.error("[support-agent] Failed to send reply:", replyErr);

          // Still save — flag so it gets human attention
          await db.insert(smSupportEmails).values({
            id,
            fromEmail: email.fromEmail,
            subject: email.subject,
            body: bodyTruncated,
            category,
            confidence: confidence != null ? String(confidence) : null,
            draftReply,
            status: "flagged",
            messageId: email.messageId,
          });

          await notifyFlagged({
            fromEmail: email.fromEmail,
            subject: email.subject,
            category,
            confidence,
            draftReply,
            reason: "send_failed",
          });
        }
      } else {
        // Determine flag reason
        const reason = hardBlocked
          ? "hard_block_keyword"
          : confidence == null
          ? "classification_failed"
          : tone === "frustrated"
          ? "frustrated_tone"
          : tone === "urgent"
          ? "urgent_tone"
          : `low_confidence_${confidence.toFixed(2)}`;

        await db.insert(smSupportEmails).values({
          id,
          fromEmail: email.fromEmail,
          subject: email.subject,
          body: bodyTruncated,
          category,
          confidence: confidence != null ? String(confidence) : null,
          draftReply,
          status: "flagged",
          messageId: email.messageId,
        });

        await notifyFlagged({
          fromEmail: email.fromEmail,
          subject: email.subject,
          category,
          confidence,
          draftReply,
          reason,
        });

        console.log(
          `[support-agent] Flagged email from ${email.fromEmail}: ${reason}`,
        );
      }
    } catch (err) {
      console.error(
        `[support-agent] Unexpected error processing email from ${email.fromEmail}:`,
        err,
      );
    }
  }
}

// ── startup ───────────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  await maybeSendDigest();
  await pollAndProcess();
}

console.log(
  `[support-agent] Starting. Poll interval: ${POLL_INTERVAL_MS / 1000}s, ` +
  `confidence threshold: ${CONFIDENCE_THRESHOLD}, digest hour: ${DIGEST_HOUR}`,
);

// Run immediately, then on interval
tick().catch((err) => console.error("[support-agent] Initial tick failed:", err));
setInterval(() => {
  tick().catch((err) => console.error("[support-agent] Tick failed:", err));
}, POLL_INTERVAL_MS);
