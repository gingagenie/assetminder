import nodemailer from "nodemailer";

export interface FlaggedEmailInfo {
  fromEmail: string;
  subject: string;
  category: string | null;
  confidence: number | null;
  draftReply: string | null;
  reason: string;
}

async function sendSlackNotification(webhookUrl: string, text: string): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook returned ${response.status}`);
  }
}

async function sendEmailNotification(toEmail: string, info: FlaggedEmailInfo): Promise<void> {
  const host = process.env.SUPPORT_EMAIL_HOST;
  const user = process.env.SUPPORT_EMAIL_USER;
  const pass = process.env.SUPPORT_EMAIL_PASS;

  if (!host || !user || !pass) {
    console.warn("[notify] SMTP not configured — email notification skipped");
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

  const draftPreview = info.draftReply
    ? info.draftReply.slice(0, 300) + (info.draftReply.length > 300 ? "..." : "")
    : "(no draft generated)";

  await transporter.sendMail({
    from: `"MinderApps Support Agent" <${user}>`,
    to: toEmail,
    subject: `[Support] Email flagged for review — from ${info.fromEmail}`,
    text: [
      "An incoming support email requires manual review.",
      "",
      `From:       ${info.fromEmail}`,
      `Subject:    ${info.subject}`,
      `Category:   ${info.category ?? "unknown"}`,
      `Confidence: ${info.confidence != null ? info.confidence.toFixed(2) : "n/a"}`,
      `Reason:     ${info.reason}`,
      "",
      "Draft Reply Preview:",
      draftPreview,
      "",
      `Please reply directly to: ${info.fromEmail}`,
    ].join("\n"),
  });
}

function buildSlackMessage(info: FlaggedEmailInfo): string {
  const confidenceStr =
    info.confidence != null ? info.confidence.toFixed(2) : "n/a";
  const draftPreview = info.draftReply
    ? info.draftReply.slice(0, 250) + (info.draftReply.length > 250 ? "..." : "")
    : "_No draft generated_";

  return [
    ":rotating_light: *Support Email Flagged for Manual Review*",
    "",
    `*From:* ${info.fromEmail}`,
    `*Subject:* ${info.subject}`,
    `*Category:* ${info.category ?? "unknown"}  |  *Confidence:* ${confidenceStr}  |  *Reason:* \`${info.reason}\``,
    "",
    "*Draft Reply Preview:*",
    `_${draftPreview}_`,
    "",
    `Please reply directly to *${info.fromEmail}*`,
  ].join("\n");
}

export async function notifyFlagged(info: FlaggedEmailInfo): Promise<void> {
  const slackWebhook = process.env.SUPPORT_SLACK_WEBHOOK_URL;
  const notifyEmail = process.env.SUPPORT_NOTIFY_EMAIL;

  const errors: string[] = [];

  if (slackWebhook) {
    try {
      await sendSlackNotification(slackWebhook, buildSlackMessage(info));
      return; // Slack succeeded — no need for email fallback
    } catch (err) {
      console.error("[notify] Slack notification failed:", err);
      errors.push("slack");
    }
  }

  if (notifyEmail) {
    try {
      await sendEmailNotification(notifyEmail, info);
    } catch (err) {
      console.error("[notify] Email notification failed:", err);
      errors.push("email");
    }
  }

  if (!slackWebhook && !notifyEmail) {
    console.warn("[notify] No notification channel configured (SUPPORT_SLACK_WEBHOOK_URL or SUPPORT_NOTIFY_EMAIL)");
  }
}
