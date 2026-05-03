import { Router, Request, Response } from "express";
import { db } from "../db/client";
import { jobberOrgs } from "../db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

const JOBBER_AUTH_URL = "https://api.getjobber.com/api/oauth/authorize";
const JOBBER_TOKEN_URL = "https://api.getjobber.com/api/oauth/token";
const JOBBER_API_VERSION = "2025-04-16";
const SCOPES = "read_clients read_jobs read_custom_field_configurations write_custom_field_configurations read_users";

const router = Router();

const CUSTOM_FIELD_CONFIGS_QUERY = `
  {
    customFieldConfigurations(first: 100) {
      nodes {
        ... on CustomFieldConfigurationText     { id name appliesTo archived }
        ... on CustomFieldConfigurationNumeric  { id name appliesTo archived }
        ... on CustomFieldConfigurationDropdown { id name appliesTo archived }
        ... on CustomFieldConfigurationArea     { id name appliesTo archived }
        ... on CustomFieldConfigurationDate     { id name appliesTo archived }
        ... on CustomFieldConfigurationTrue     { id name appliesTo archived }
      }
    }
  }
`;

const ASSET_FIELD_LABELS = /serial|asset|equipment|\bid\b/i;

async function autoSetupAssetField(jobberAccountId: string, accessToken: string): Promise<void> {
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
  if (!cfRes.ok) throw new Error(`Jobber HTTP ${cfRes.status}: ${cfText}`);

  const cfJson = JSON.parse(cfText) as {
    data?: { customFieldConfigurations: { nodes: { id: string; name: string; appliesTo: string; archived: boolean }[] } };
    errors?: { message: string }[];
  };

  if (cfJson.errors?.length) {
    throw new Error(cfJson.errors.map((e) => e.message).join(", "));
  }

  const nodes = cfJson.data?.customFieldConfigurations?.nodes ?? [];
  const jobFields = nodes.filter((n) => n.appliesTo?.toUpperCase().includes("JOB") && !n.archived);

  // Look for an existing field whose name matches the asset-related keywords
  const match = jobFields.find((n) => ASSET_FIELD_LABELS.test(n.name));

  if (match) {
    console.log(`[callback] Found existing asset field: "${match.name}" (${match.id})`);
    await db
      .update(jobberOrgs)
      .set({ assetIdentifierField: match.name, assetIdentifierFieldId: match.id, updatedAt: new Date() })
      .where(eq(jobberOrgs.jobberAccountId, jobberAccountId));
    return;
  }

  // No suitable field found — create one
  console.log(`[callback] No suitable asset field found, creating "Asset ID"…`);
  const createMutation = `
    mutation {
      customFieldConfigurationCreate(input: {
        label: "Asset ID"
        fieldType: TEXT
        appliesTo: JOB
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
  if (!createRes.ok) throw new Error(`Jobber HTTP ${createRes.status}: ${createText}`);

  const createJson = JSON.parse(createText) as {
    data?: {
      customFieldConfigurationCreate: {
        customFieldConfiguration: { id: string; name: string } | null;
        userErrors: { message: string }[];
      };
    };
    errors?: { message: string }[];
  };

  if (createJson.errors?.length) {
    throw new Error(createJson.errors.map((e) => e.message).join(", "));
  }

  const payload = createJson.data?.customFieldConfigurationCreate;
  if (payload?.userErrors?.length) {
    throw new Error(payload.userErrors.map((e) => e.message).join(", "));
  }

  const created = payload?.customFieldConfiguration;
  if (!created) throw new Error("customFieldConfigurationCreate returned no configuration");

  console.log(`[callback] Created asset field: "${created.name}" (${created.id})`);
  await db
    .update(jobberOrgs)
    .set({ assetIdentifierField: created.name, assetIdentifierFieldId: created.id, updatedAt: new Date() })
    .where(eq(jobberOrgs.jobberAccountId, jobberAccountId));
}

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

  // Auto-detect or create a custom field for asset identification if not already configured
  const needsFieldSetup = existing.length === 0 || !existing[0].assetIdentifierField;
  if (needsFieldSetup) {
    try {
      await autoSetupAssetField(jobberAccountId, tokens.access_token);
    } catch (err) {
      console.warn("[callback] Asset field auto-setup failed, user will configure manually:", err);
    }
  }

  const frontendBase = process.env.FRONTEND_URL ?? "http://localhost:3000";
  res.redirect(`${frontendBase}/#/oauth/callback?jobberAccountId=${encodeURIComponent(jobberAccountId)}`);
});

export default router;
