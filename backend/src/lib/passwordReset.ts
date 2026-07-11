import crypto from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { passwordResetTokens } from "../db/schema";

/** Reset links are short-lived. */
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Only the hash of the reset token is stored, never the raw token. */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createResetToken(jobberAccountId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  await db.insert(passwordResetTokens).values({
    id: crypto.randomUUID(),
    jobberAccountId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });
  return token;
}

/**
 * Validate and atomically consume a reset token (single-use). Returns the
 * jobberAccountId on success, or null if the token is unknown, expired, or
 * already used. The conditional update guards against a double-submit race.
 */
export async function consumeResetToken(token: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, hashToken(token)))
    .limit(1);
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) return null;

  const claimed = await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResetTokens.id, row.id), isNull(passwordResetTokens.usedAt)))
    .returning({ id: passwordResetTokens.id });
  if (claimed.length === 0) return null; // lost the race to a concurrent request

  return row.jobberAccountId;
}
