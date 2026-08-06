import crypto from "crypto";
import { db } from "../db/client";
import { loginEvents } from "../db/schema";

export async function logEvent(
  jobberAccountId: string,
  eventType: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(loginEvents).values({
      id: crypto.randomUUID(),
      jobberAccountId,
      eventType,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });
  } catch (err) {
    console.error(`[events] failed to log ${eventType} for ${jobberAccountId}:`, String(err));
  }
}
