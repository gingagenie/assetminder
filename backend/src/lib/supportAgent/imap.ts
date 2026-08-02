import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export interface FetchedEmail {
  uid: number;
  fromEmail: string;
  subject: string;
  body: string;
  messageId: string | null;
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function buildClient(): ImapFlow | null {
  const host = process.env.SUPPORT_EMAIL_HOST;
  const user = process.env.SUPPORT_EMAIL_USER;
  const pass = process.env.SUPPORT_EMAIL_PASS;

  if (!host || !user || !pass) return null;

  const port = Number(process.env.SUPPORT_EMAIL_IMAP_PORT ?? 993);
  return new ImapFlow({
    host,
    port,
    secure: port === 993, // 993 = implicit TLS; 143 = STARTTLS (imapflow handles automatically)
    auth: { user, pass },
    logger: false,
  });
}

export async function fetchUnseenEmails(): Promise<FetchedEmail[]> {
  const client = buildClient();

  if (!client) {
    console.warn("[imap] SUPPORT_EMAIL_* env vars not set — skipping poll");
    return [];
  }

  const results: FetchedEmail[] = [];

  try {
    await client.connect();

    const lock = await client.getMailboxLock("INBOX");
    try {
      const rawUids = await client.search({ seen: false }, { uid: true });
      const uids: number[] = Array.isArray(rawUids) ? rawUids : [];

      if (uids.length === 0) {
        return [];
      }

      for await (const msg of client.fetch(uids, { source: true }, { uid: true })) {
        if (!msg.source) continue;

        try {
          // simpleParser is overloaded — pass options object to hit the Promise overload
          const parsed = await simpleParser(msg.source, {});

          const fromEmail = parsed.from?.value?.[0]?.address ?? "";
          if (!fromEmail) continue;

          const subject = parsed.subject?.trim() ?? "(no subject)";
          const htmlStr = typeof parsed.html === "string" ? parsed.html : "";
          const body = parsed.text?.trim() || stripHtmlTags(htmlStr);
          const messageId = parsed.messageId ?? null;

          results.push({ uid: msg.uid, fromEmail, subject, body, messageId });
        } catch (parseErr) {
          console.error(`[imap] Failed to parse message uid=${msg.uid}:`, parseErr);
        }
      }

      if (results.length > 0) {
        const processedUids = results.map((r) => r.uid);
        await client.messageFlagsAdd(processedUids, ["\\Seen"], { uid: true });
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    console.error("[imap] Error fetching emails:", err);
    try {
      await client.logout();
    } catch {}
  }

  return results;
}
