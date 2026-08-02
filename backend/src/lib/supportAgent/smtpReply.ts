import nodemailer, { Transporter } from "nodemailer";

let _transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  const host = process.env.SUPPORT_EMAIL_HOST;
  const user = process.env.SUPPORT_EMAIL_USER;
  const pass = process.env.SUPPORT_EMAIL_PASS;

  if (!host || !user || !pass) return null;

  if (!_transporter) {
    const port = Number(process.env.SUPPORT_EMAIL_SMTP_PORT ?? 587);
    _transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      auth: { user, pass },
    });
  }

  return _transporter;
}

export async function sendReply(
  toEmail: string,
  originalSubject: string,
  replyText: string,
  inReplyTo: string | null,
): Promise<void> {
  const tx = getTransporter();
  const fromUser = process.env.SUPPORT_EMAIL_USER ?? "support@minderapps.io";

  if (!tx) {
    console.warn("[smtp-reply] SMTP not configured — reply not sent to", toEmail);
    return;
  }

  const subject = originalSubject.startsWith("Re:")
    ? originalSubject
    : `Re: ${originalSubject}`;

  const htmlBody = replyText
    .split("\n")
    .map((line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`)
    .join("\n");

  const mailOptions: nodemailer.SendMailOptions = {
    from: `"MinderApps Support" <${fromUser}>`,
    to: toEmail,
    subject,
    text: replyText,
    html: htmlBody,
  };

  if (inReplyTo) {
    mailOptions.inReplyTo = inReplyTo;
    mailOptions.references = inReplyTo;
  }

  await tx.sendMail(mailOptions);
}
