import nodemailer, { Transporter } from "nodemailer";

let transporter: Transporter | null = null;

/**
 * Lazily build the SMTP transporter (Namecheap Private Email:
 * mail.privateemail.com:587, STARTTLS). Returns null when SMTP isn't
 * configured so a missing mailbox doesn't crash startup.
 */
function getTransporter(): Transporter | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;

  if (!transporter) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // 465 = implicit TLS; 587 = STARTTLS (upgraded below)
      requireTLS: port !== 465,
      auth: { user, pass },
    });
  }
  return transporter;
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const tx = getTransporter();
  const fromEmail = process.env.MAIL_FROM_EMAIL ?? "support@minderapps.io";
  const fromName = process.env.MAIL_FROM_NAME ?? "AssetMinder";

  if (!tx) {
    // Unconfigured (e.g. local dev): don't break the flow — log the link so it
    // can still be exercised. Never happens in prod once SMTP env is set.
    console.warn("[mailer] SMTP not configured — reset link (not emailed):", resetUrl);
    return;
  }

  const text =
    `We received a request to reset your AssetMinder password.\n\n` +
    `Reset it here (link expires in 1 hour):\n${resetUrl}\n\n` +
    `If you didn't request this, you can safely ignore this email.`;
  const html =
    `<p>We received a request to reset your AssetMinder password.</p>` +
    `<p><a href="${resetUrl}">Reset your password</a> (link expires in 1 hour).</p>` +
    `<p>If you didn't request this, you can safely ignore this email.</p>`;

  await tx.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject: "Reset your AssetMinder password",
    text,
    html,
  });
}
