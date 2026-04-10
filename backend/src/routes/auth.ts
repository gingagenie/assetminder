import { Router, Request, Response } from "express";
import { db } from "../db/client";
import { jobberOrgs } from "../db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

const router = Router();

const JOBBER_AUTH_URL = "https://api.getjobber.com/api/oauth/authorize";
const JOBBER_TOKEN_URL = "https://api.getjobber.com/api/oauth/token";
const JOBBER_API_VERSION = "2025-04-16";
const SCOPES = "read_clients read_jobs read_custom_field_configurations read_users";

router.get("/connect", (_req: Request, res: Response) => {
  const params = new URLSearchParams({
    client_id: process.env.JOBBER_CLIENT_ID!,
    redirect_uri: process.env.JOBBER_REDIRECT_URI!,
    response_type: "code",
    scope: SCOPES,
  });

  res.redirect(`${JOBBER_AUTH_URL}?${params.toString()}`);
});

router.get("/callback", async (req: Request, res: Response) => {
  const { code, error } = req.query;

  if (error || !code || typeof code !== "string") {
    res.status(400).json({ error: error ?? "Missing authorization code" });
    return;
  }

  const tokenRes = await fetch(JOBBER_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.JOBBER_CLIENT_ID!,
      client_secret: process.env.JOBBER_CLIENT_SECRET!,
      redirect_uri: process.env.JOBBER_REDIRECT_URI!,
      code,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    res.status(502).json({ error: "Token exchange failed", detail: body });
    return;
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in?: number;
    token_type: string;
  };

  // Jobber does not return expires_in; assume 1 hour and let refresh middleware handle renewal
  const expiresInMs = (tokens.expires_in ?? 3600) * 1000;
  const expiresAt = new Date(Date.now() + expiresInMs);

  // Fetch the Jobber account ID so we can upsert correctly
  const meRes = await fetch("https://api.getjobber.com/api/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokens.access_token}`,
      "X-JOBBER-GRAPHQL-VERSION": JOBBER_API_VERSION,
    },
    body: JSON.stringify({ query: "{ account { id } }" }),
  });

  const meBody = await meRes.text();

  if (!meRes.ok) {
    console.error("[callback] GraphQL HTTP error", meRes.status, meBody);
    res.status(502).json({
      error: "Failed to fetch Jobber account ID",
      status: meRes.status,
      detail: meBody,
    });
    return;
  }

  console.log("[callback] GraphQL response:", meBody);

  const meJson = JSON.parse(meBody) as {
    data?: { account?: { id: string } };
    errors?: unknown[];
  };

  if (meJson.errors || !meJson.data?.account?.id) {
    console.error("[callback] GraphQL errors or missing account.id:", meJson);
    res.status(502).json({
      error: "Jobber GraphQL returned no account ID",
      detail: meJson,
    });
    return;
  }

  const meData = meJson as { data: { account: { id: string } } };
  const jobberAccountId = meData.data.account.id;

  // Upsert: update tokens if this org already exists, insert if new
  const existing = await db
    .select()
    .from(jobberOrgs)
    .where(eq(jobberOrgs.jobberAccountId, jobberAccountId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(jobberOrgs)
      .set({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(jobberOrgs.jobberAccountId, jobberAccountId));
  } else {
    await db.insert(jobberOrgs).values({
      id: crypto.randomUUID(),
      jobberAccountId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
    });
  }

  const frontendBase = process.env.FRONTEND_URL ?? "http://localhost:3000";
  res.redirect(`${frontendBase}/oauth/callback?jobberAccountId=${encodeURIComponent(jobberAccountId)}`);
});

export default router;
