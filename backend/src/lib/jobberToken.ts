import { db } from "../db/client";
import { jobberOrgs, type JobberOrg } from "../db/schema";
import { eq } from "drizzle-orm";
import { deleteOrgData } from "./deleteOrg";

const JOBBER_TOKEN_URL = "https://api.getjobber.com/api/oauth/token";
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Returns a valid Jobber access token for the given account.
 * Automatically refreshes if the token is within 5 minutes of expiry.
 * Throws if the org is not found or the refresh fails.
 */
export async function getValidToken(jobberAccountId: string): Promise<string> {
  const [org] = await db
    .select()
    .from(jobberOrgs)
    .where(eq(jobberOrgs.jobberAccountId, jobberAccountId))
    .limit(1);

  if (!org) {
    throw new Error(`No Jobber org found for account ID: ${jobberAccountId}`);
  }

  const expiresAt = new Date(org.expiresAt); // coerce string→Date when pooler returns a string
  const needsRefresh =
    expiresAt.getTime() - Date.now() < REFRESH_THRESHOLD_MS;

  if (!needsRefresh) {
    return org.accessToken;
  }

  return refreshToken(org);
}

async function refreshToken(org: JobberOrg): Promise<string> {
  const res = await fetch(JOBBER_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.JOBBER_CLIENT_ID!,
      client_secret: process.env.JOBBER_CLIENT_SECRET!,
      refresh_token: org.refreshToken,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    // 400/401 from Jobber's OAuth server = refresh token permanently invalid (revoked or expired).
    // Treat as a disconnect: clean up org data so polling stops flooding error logs.
    if (res.status === 400 || res.status === 401) {
      console.log(`[token] refresh rejected (${res.status}) for ${org.jobberAccountId} — treating as disconnect`);
      await deleteOrgData(org.jobberAccountId);
      throw new Error(`disconnected this app — token refresh rejected (${res.status}) for ${org.jobberAccountId}`);
    }
    throw new Error(`Token refresh failed for ${org.jobberAccountId}: ${detail}`);
  }

  const tokens = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in?: number;
  };

  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000);

  await db
    .update(jobberOrgs)
    .set({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(jobberOrgs.jobberAccountId, org.jobberAccountId));

  return tokens.access_token;
}
