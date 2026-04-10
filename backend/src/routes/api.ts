import { Router, Request, Response } from "express";
import { eq, and } from "drizzle-orm";
import { getValidToken } from "../lib/jobberToken";
import { syncOrg } from "../lib/sync";
import { groupAssets } from "../lib/groupAssets";
import { db } from "../db/client";
import { jobberOrgs, assets } from "../db/schema";

const router = Router();

const JOBBER_GRAPHQL_URL = "https://api.getjobber.com/api/graphql";
const JOBBER_API_VERSION = "2025-04-16";

// ---------- helpers ----------

async function jobberGql<T>(accessToken: string, query: string): Promise<T> {
  const res = await fetch(JOBBER_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-JOBBER-GRAPHQL-VERSION": JOBBER_API_VERSION,
    },
    body: JSON.stringify({ query }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Jobber HTTP ${res.status}: ${text}`);

  const json = JSON.parse(text) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join(", "));

  return json.data as T;
}

async function requireOrg(jobberAccountId: string) {
  const [org] = await db
    .select()
    .from(jobberOrgs)
    .where(eq(jobberOrgs.jobberAccountId, jobberAccountId))
    .limit(1);
  if (!org) throw new Error(`Org not found: ${jobberAccountId}`);
  return org;
}

// ---------- GET /api/me ----------

router.get("/me", async (req: Request, res: Response) => {
  const { jobberAccountId } = req.query;

  if (!jobberAccountId || typeof jobberAccountId !== "string") {
    res.status(400).json({ error: "Missing required query param: jobberAccountId" });
    return;
  }

  try {
    const accessToken = await getValidToken(jobberAccountId);
    const data = await jobberGql<{ account: { name: string } }>(accessToken, "{ account { name } }");
    res.json({ accountName: data.account.name });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------- POST /api/sync ----------

router.post("/sync", async (req: Request, res: Response) => {
  const { jobberAccountId } = req.body as { jobberAccountId?: string };

  if (!jobberAccountId) {
    res.status(400).json({ error: "Missing required body param: jobberAccountId" });
    return;
  }

  try {
    const result = await syncOrg(jobberAccountId);
    res.json(result);
  } catch (err) {
    console.error("[sync] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- GET /api/custom-fields ----------

const CUSTOM_FIELD_CONFIGS_QUERY = `
  {
    customFieldConfigurations(first: 100) {
      nodes {
        ... on CustomFieldConfigurationText      { id name appliesTo archived }
        ... on CustomFieldConfigurationNumeric   { id name appliesTo archived }
        ... on CustomFieldConfigurationDropdown  { id name appliesTo archived }
        ... on CustomFieldConfigurationArea      { id name appliesTo archived }
        ... on CustomFieldConfigurationLink      { id name appliesTo archived }
        ... on CustomFieldConfigurationTrueFalse { id name appliesTo archived }
      }
    }
  }
`;

router.get("/custom-fields", async (req: Request, res: Response) => {
  const { jobberAccountId } = req.query;

  if (!jobberAccountId || typeof jobberAccountId !== "string") {
    res.status(400).json({ error: "Missing required query param: jobberAccountId" });
    return;
  }

  try {
    const accessToken = await getValidToken(jobberAccountId);
    const data = await jobberGql<{
      customFieldConfigurations: {
        nodes: { id: string; name: string; appliesTo: string; archived: boolean }[];
      };
    }>(accessToken, CUSTOM_FIELD_CONFIGS_QUERY);

    const fields = data.customFieldConfigurations.nodes
      .filter((n) => n.appliesTo?.toUpperCase().includes("JOB") && !n.archived)
      .map((n) => ({ id: n.id, label: n.name }));

    res.json({ fields });
  } catch (err) {
    console.error("[custom-fields] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- POST /api/orgs/field-mapping ----------

router.post("/orgs/field-mapping", async (req: Request, res: Response) => {
  const { jobberAccountId, fieldLabel } = req.body as {
    jobberAccountId?: string;
    fieldLabel?: string;
  };

  if (!jobberAccountId || !fieldLabel) {
    res.status(400).json({ error: "Missing required body params: jobberAccountId, fieldLabel" });
    return;
  }

  try {
    const org = await requireOrg(jobberAccountId);

    await db
      .update(jobberOrgs)
      .set({ assetIdentifierField: fieldLabel, updatedAt: new Date() })
      .where(eq(jobberOrgs.id, org.id));

    res.json({ ok: true, jobberAccountId, assetIdentifierField: fieldLabel });
  } catch (err) {
    console.error("[field-mapping] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- GET /api/orgs/field-mapping ----------

router.get("/orgs/field-mapping", async (req: Request, res: Response) => {
  const { jobberAccountId } = req.query;

  if (!jobberAccountId || typeof jobberAccountId !== "string") {
    res.status(400).json({ error: "Missing required query param: jobberAccountId" });
    return;
  }

  try {
    const org = await requireOrg(jobberAccountId);
    res.json({ assetIdentifierField: org.assetIdentifierField ?? null });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------- POST /api/group-assets ----------

router.post("/group-assets", async (req: Request, res: Response) => {
  const { jobberAccountId } = req.body as { jobberAccountId?: string };

  if (!jobberAccountId) {
    res.status(400).json({ error: "Missing required body param: jobberAccountId" });
    return;
  }

  try {
    const result = await groupAssets(jobberAccountId);
    res.json({ assets: result });
  } catch (err) {
    console.error("[group-assets] error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------- GET /api/assets ----------

router.get("/assets", async (req: Request, res: Response) => {
  const { jobberAccountId, clientId } = req.query;

  if (!jobberAccountId || typeof jobberAccountId !== "string") {
    res.status(400).json({ error: "Missing required query param: jobberAccountId" });
    return;
  }

  try {
    const org = await requireOrg(jobberAccountId);

    const rows = await db
      .select()
      .from(assets)
      .where(
        clientId && typeof clientId === "string"
          ? and(eq(assets.orgId, org.id), eq(assets.jobberClientId, clientId))
          : eq(assets.orgId, org.id)
      );

    res.json({
      assets: rows.map((a) => ({
        id: a.id,
        identifier: a.identifier,
        displayName: a.displayName,
        jobberClientId: a.jobberClientId,
        lastServicedAt: a.lastServicedAt ?? null,
        jobCount: a.jobCount,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
