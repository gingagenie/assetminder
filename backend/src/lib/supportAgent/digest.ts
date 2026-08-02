import { db } from "../../db/client";
import { smSupportEmails } from "../../db/schema";
import { eq, and, gte } from "drizzle-orm";
import nodemailer from "nodemailer";

async function sendSlackDigest(webhookUrl: string, text: string): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook returned ${response.status}`);
  }
}

async function sendEmailDigest(toEmail: string, subject: string, body: string): Promise<void> {
  const host = process.env.SUPPORT_EMAIL_HOST;
  const user = process.env.SUPPORT_EMAIL_USER;
  const pass = process.env.SUPPORT_EMAIL_PASS;

  if (!host || !user || !pass) {
    console.warn("[digest] SMTP not configured — digest email skipped");
    return;
  }

  const port = Number(process.env.SUPPORT_EMAIL_SMTP_PORT ?? 587);
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: `"MinderApps Support Agent" <${user}>`,
    to: toEmail,
    subject,
    text: body,
  });
}

export async function sendDigest(): Promise<void> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const emails = await db
    .select()
    .from(smSupportEmails)
    .where(and(eq(smSupportEmails.status, "auto_replied"), gte(smSupportEmails.createdAt, startOfDay)));

  const flagged = await db
    .select()
    .from(smSupportEmails)
    .where(and(eq(smSupportEmails.status, "flagged"), gte(smSupportEmails.createdAt, startOfDay)));

  const total = emails.length + flagged.length;

  if (total === 0) {
    console.log("[digest] No emails today — skipping digest");
    return;
  }

  const dateStr = startOfDay.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const categoryBreakdown = emails.reduce<Record<string, number>>((acc, e) => {
    const cat = e.category ?? "other";
    acc[cat] = (acc[cat] ?? 0) + 1;
    return acc;
  }, {});

  const categoryLines = Object.entries(categoryBreakdown)
    .map(([cat, count]) => `  • ${cat}: ${count}`)
    .join("\n");

  const autoRepliedBlock =
    emails.length > 0
      ? [
          `*Auto-replied:* ${emails.length}`,
          categoryLines ? `Categories:\n${categoryLines}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "*Auto-replied:* 0";

  const flaggedBlock =
    flagged.length > 0
      ? [
          `*Flagged for review:* ${flagged.length}`,
          flagged.map((e) => `  • ${e.fromEmail} — ${e.subject.slice(0, 60)}`).join("\n"),
        ].join("\n")
      : "*Flagged for review:* 0";

  const slackMessage = [
    `:envelope: *Daily Support Digest — ${dateStr}*`,
    "",
    autoRepliedBlock,
    "",
    flaggedBlock,
    "",
    "_Spot-check the auto-replies above to ensure quality._",
  ].join("\n");

  const emailBody = slackMessage.replace(/\*/g, "").replace(/_/g, "").replace(/:/g, "");

  const slackWebhook = process.env.SUPPORT_SLACK_WEBHOOK_URL;
  const notifyEmail = process.env.SUPPORT_NOTIFY_EMAIL;

  if (slackWebhook) {
    try {
      await sendSlackDigest(slackWebhook, slackMessage);
      console.log(`[digest] Sent daily digest via Slack (${total} emails)`);
    } catch (err) {
      console.error("[digest] Slack digest failed:", err);
    }
  } else if (notifyEmail) {
    try {
      await sendEmailDigest(
        notifyEmail,
        `[Support Digest] ${dateStr} — ${emails.length} auto-replied, ${flagged.length} flagged`,
        emailBody,
      );
      console.log(`[digest] Sent daily digest via email (${total} emails)`);
    } catch (err) {
      console.error("[digest] Email digest failed:", err);
    }
  }
}
