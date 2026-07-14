import { Router, Request, Response } from "express";
import { db } from "../db/client";
import { jobberOrgs, loginEvents } from "../db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "../lib/session";

const JOBBER_AUTH_URL = "https://api.getjobber.com/api/oauth/authorize";
const JOBBER_TOKEN_URL = "https://api.getjobber.com/api/oauth/token";
const JOBBER_API_VERSION = "2025-04-16";
const SCOPES = "read_clients read_jobs write_jobs read_custom_field_configurations write_custom_field_configurations read_users";

const router = Router();

const CUSTOM_FIELD_CONFIGS_QUERY = `
  {
    customFieldConfigurations(first: 100) {
      nodes {
        ... on CustomFieldConfigurationText      { id name appliesTo }
        ... on CustomFieldConfigurationNumeric   { id name appliesTo }
        ... on CustomFieldConfigurationDropdown  { id name appliesTo }
        ... on CustomFieldConfigurationArea      { id name appliesTo }
        ... on CustomFieldConfigurationLink      { id name appliesTo }
        ... on CustomFieldConfigurationTrueFalse { id name appliesTo }
      }
    }
  }
`;

const ASSET_FIELD_LABELS = /serial|asset|equipment|\bid\b/i;

async function autoSetupAssetField(jobberAccountId: string, accessToken: string): Promise<void> {
  console.log(`[asset-field] Running auto-setup for org ${jobberAccountId}`);

  // Query existing custom field configurations
  const cfRes = await fetch("https://api.getjobber.com/api/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-JOBBER-GRAPHQL-VERSION": JOBBER_API_VERSION,
    },
    body: JSON.stringify({ query: CUSTOM_FIELD_CONFIGS_QUERY }),
  });

  const cfText = await cfRes.text();
  console.log(`[asset-field] customFieldConfigurations raw response (HTTP ${cfRes.status}):`, cfText);

  if (!cfRes.ok) throw new Error(`Jobber HTTP ${cfRes.status}: ${cfText}`);

  const cfJson = JSON.parse(cfText) as {
    data?: { customFieldConfigurations: { nodes: { id: string; name: string; appliesTo: string }[] } };
    errors?: { message: string }[];
  };

  if (cfJson.errors?.length) {
    throw new Error(`GraphQL errors: ${cfJson.errors.map((e) => e.message).join(", ")}`);
  }

  const nodes = cfJson.data?.customFieldConfigurations?.nodes ?? [];
  const jobFields = nodes.filter((n) => n.appliesTo?.toUpperCase().includes("JOB"));
  console.log(`[asset-field] Found ${nodes.length} total field(s), ${jobFields.length} on JOB:`, jobFields.map((n) => n.name));

  // Look for an existing field whose name matches the asset-related keywords
  const match = jobFields.find((n) => ASSET_FIELD_LABELS.test(n.name));

  if (match) {
    console.log(`[asset-field] Matched existing field: "${match.name}" (${match.id})`);
    await db
      .update(jobberOrgs)
      .set({ assetIdentifierField: match.name, assetIdentifierFieldId: match.id, updatedAt: new Date() })
      .where(eq(jobberOrgs.jobberAccountId, jobberAccountId));
    return;
  }

  // No suitable field found — create one
  console.log(`[asset-field] No suitable field found among ${jobFields.length} job field(s). Creating "Asset ID"…`);
  const createMutation = `
    mutation {
      customFieldConfigurationCreateText(input: {
        name: "Asset ID"
        appliesTo: ALL_JOBS
        transferable: false
        readOnly: false
      }) {
        customFieldConfiguration {
          ... on CustomFieldConfigurationText { id name }
        }
        userErrors { message }
      }
    }
  `;

  const createRes = await fetch("https://api.getjobber.com/api/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-JOBBER-GRAPHQL-VERSION": JOBBER_API_VERSION,
    },
    body: JSON.stringify({ query: createMutation }),
  });

  const createText = await createRes.text();
  console.log(`[asset-field] customFieldConfigurationCreateText raw response (HTTP ${createRes.status}):`, createText);

  if (!createRes.ok) throw new Error(`Jobber HTTP ${createRes.status}: ${createText}`);

  const createJson = JSON.parse(createText) as {
    data?: {
      customFieldConfigurationCreateText: {
        customFieldConfiguration: { id: string; name: string } | null;
        userErrors: { message: string }[];
      };
    };
    errors?: { message: string }[];
  };

  if (createJson.errors?.length) {
    throw new Error(`GraphQL errors: ${createJson.errors.map((e) => e.message).join(", ")}`);
  }

  const payload = createJson.data?.customFieldConfigurationCreateText;
  if (payload?.userErrors?.length) {
    throw new Error(`userErrors: ${payload.userErrors.map((e) => e.message).join(", ")}`);
  }

  const created = payload?.customFieldConfiguration;
  if (!created) throw new Error(`customFieldConfigurationCreateText returned no configuration. Full response: ${createText}`);

  console.log(`[asset-field] Created field: "${created.name}" (${created.id})`);
  await db
    .update(jobberOrgs)
    .set({ assetIdentifierField: created.name, assetIdentifierFieldId: created.id, updatedAt: new Date() })
    .where(eq(jobberOrgs.jobberAccountId, jobberAccountId));
}

router.get("/connect", (req: Request, res: Response) => {
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
    body: JSON.stringify({
      query:
        "{ account { id name } users(first: 10) { nodes { isCurrentUser email { raw } } } }",
    }),
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

  const meJson = JSON.parse(meBody) as {
    data?: {
      account?: { id: string; name?: string };
      users?: { nodes?: Array<{ isCurrentUser?: boolean; email?: { raw?: string } }> };
    };
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

  const jobberAccountId = meJson.data.account.id;
  const orgName = meJson.data.account.name ?? null;
  // Email of the user who authorized this token — selected by isCurrentUser, not
  // array position (multi-user accounts return many users). Used to pre-fill the
  // set-password screen and as the login identity.
  const ownerEmail =
    meJson.data.users?.nodes?.find((n) => n.isCurrentUser)?.email?.raw?.trim().toLowerCase() ??
    null;

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
        name: orgName,
        lastKnownName: orgName,
        // Backfill only when missing — email is the login identity and unique.
        email: existing[0].email ?? ownerEmail,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        // Clear the tombstone marker — this account is active again.
        // trial_started_at and subscription_status are NOT reset here,
        // so a reconnect after disconnect never grants a fresh trial.
        disconnectedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(jobberOrgs.jobberAccountId, jobberAccountId));
  } else {
    const now = new Date();
    await db.insert(jobberOrgs).values({
      id: crypto.randomUUID(),
      jobberAccountId,
      name: orgName,
      lastKnownName: orgName,
      email: ownerEmail,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      trialStartedAt: now,
      subscriptionStatus: "trial",
    });
  }

  await db.insert(loginEvents).values({
    id: crypto.randomUUID(),
    jobberAccountId,
    eventType: "oauth_login",
  });

  // Auto-detect or create a custom field for asset identification if not already configured
  const needsFieldSetup = existing.length === 0 || !existing[0].assetIdentifierField;
  if (needsFieldSetup) {
    try {
      await autoSetupAssetField(jobberAccountId, tokens.access_token);
    } catch (err) {
      console.error("[asset-field] Auto-setup failed — user will land on onboarding:", String(err));
    }
  }

  // OAuth is onboarding, not authentication. If the account already has a
  // password, the user must authenticate with it — do NOT issue a session here
  // (otherwise "Connect with Jobber" would be a password bypass on any device
  // with a live Jobber session). Redirect to login with the email pre-filled.
  const hasPassword = existing.length > 0 && Boolean(existing[0].passwordHash);
  const accountEmail = (existing.length > 0 ? existing[0].email ?? ownerEmail : ownerEmail) ?? "";
  const frontendBase = process.env.FRONTEND_URL ?? "http://localhost:3000";

  if (hasPassword) {
    res.redirect(`${frontendBase}/#/login?email=${encodeURIComponent(accountEmail)}`);
    return;
  }

  // No password yet: this is first-time onboarding. Establish a session so the
  // user can set a password (email pre-filled via GET /auth/session), then
  // continue to onboarding/dashboard.
  const { token } = await createSession(jobberAccountId, {
    userAgent: req.get("user-agent") ?? null,
    ip: req.ip ?? null,
  });
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  res.redirect(`${frontendBase}/#/oauth/callback`);
});

export default router;
