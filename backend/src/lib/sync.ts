import crypto from "crypto";
import { db } from "../db/client";
import { jobberOrgs, clients, jobs, jobCustomFields, jobLineItems } from "../db/schema";
import { eq, inArray } from "drizzle-orm";
import { getValidToken } from "./jobberToken";

const JOBBER_GRAPHQL_URL = "https://api.getjobber.com/api/graphql";
const JOBBER_API_VERSION = "2025-04-16";
const PAGE_SIZE = 50;

// ---------- GraphQL helper ----------

async function gql<T>(accessToken: string, query: string, variables: Record<string, unknown> = {}, attempt = 1): Promise<T> {
  const res = await fetch(JOBBER_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-JOBBER-GRAPHQL-VERSION": JOBBER_API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Jobber GraphQL HTTP ${res.status}: ${text}`);
  }

  const json = JSON.parse(text) as { data?: T; errors?: { message: string }[] };

  if (json.errors?.length) {
    const isThrottled = json.errors.some((e) => e.message.toLowerCase().includes("throttl"));
    if (isThrottled && attempt < 4) {
      const delay = attempt * 10000;
      console.log(`[sync] Throttled by Jobber, retrying in ${delay}ms (attempt ${attempt})...`);
      await new Promise((r) => setTimeout(r, delay));
      return gql<T>(accessToken, query, variables, attempt + 1);
    }
    throw new Error(`Jobber GraphQL errors: ${json.errors.map((e) => e.message).join(", ")}`);
  }

  return json.data as T;
}

// ---------- Jobber response types ----------

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface JobberClientNode {
  id: string;
  firstName: string;
  lastName: string;
  companyName: string | null;
  emails: { address: string }[];
}

interface JobberCustomField {
  label: string;
  valueText?: string;
  valueNumeric?: number;
  valueDropdown?: string;
  valueArea?: { length: number; width: number };
  valueLink?: { text: string; url: string };
  valueTrueFalse?: boolean;
}

interface JobberLineItem {
  name: string;
  quantity: number;
  unitPrice: number;
}

interface JobberJobNode {
  id: string;
  jobNumber: number | null;
  title: string | null;
  jobStatus: string;
  createdAt: string;
  completedAt: string | null;
  instructions: string | null;
  client: { id: string } | null;
  lineItems: { nodes: JobberLineItem[] };
  customFields: JobberCustomField[];
}

// ---------- Client sync ----------

const CLIENTS_QUERY = `
  query GetClients($first: Int!, $after: String) {
    clients(first: $first, after: $after) {
      nodes {
        id
        firstName
        lastName
        companyName
        emails {
          address
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

async function syncClients(accessToken: string, orgId: string): Promise<number> {
  let cursor: string | null = null;
  let total = 0;

  do {
    const data: { clients: { nodes: JobberClientNode[]; pageInfo: PageInfo } } = await gql(
      accessToken,
      CLIENTS_QUERY,
      { first: PAGE_SIZE, after: cursor }
    );

    const nodes = data.clients.nodes;
    if (nodes.length === 0) break;

    for (const c of nodes) {
      const row = {
        id: crypto.randomUUID(),
        orgId,
        jobberClientId: c.id,
        name: [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || "Unknown",
        companyName: c.companyName ?? null,
        email: c.emails[0]?.address ?? null,
      };

      await db
        .insert(clients)
        .values(row)
        .onConflictDoUpdate({
          target: [clients.orgId, clients.jobberClientId],
          set: {
            name: row.name,
            companyName: row.companyName,
            email: row.email,
          },
        });
    }

    total += nodes.length;
    cursor = data.clients.pageInfo.endCursor;

    console.log(`[sync] clients page done, total so far: ${total}`);
  } while (cursor);

  return total;
}

function safeDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    console.warn(`[sync] invalid date value: ${value}`);
    return null;
  }
  return d;
}

function customFieldValue(cf: JobberCustomField): string | null {
  if (cf.valueText !== undefined) return cf.valueText;
  if (cf.valueNumeric !== undefined) return String(cf.valueNumeric);
  if (cf.valueDropdown !== undefined) return cf.valueDropdown;
  if (cf.valueArea !== undefined) return `${cf.valueArea.length}x${cf.valueArea.width}`;
  if (cf.valueLink !== undefined) return cf.valueLink.url;
  if (cf.valueTrueFalse !== undefined) return String(cf.valueTrueFalse);
  return null;
}

// ---------- Job sync ----------

const JOBS_QUERY = `
  query GetJobs($first: Int!, $after: String) {
    jobs(first: $first, after: $after) {
      nodes {
        id
        jobNumber
        title
        jobStatus
        createdAt
        completedAt
        instructions
        client {
          id
        }
        lineItems {
          nodes {
            name
            quantity
            unitPrice
          }
        }
        customFields {
          ... on CustomFieldText      { label valueText }
          ... on CustomFieldNumeric   { label valueNumeric }
          ... on CustomFieldDropdown  { label valueDropdown }
          ... on CustomFieldArea      { label valueArea { length width } }
          ... on CustomFieldLink      { label valueLink { text url } }
          ... on CustomFieldTrueFalse { label valueTrueFalse }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

async function syncJobs(accessToken: string, orgId: string): Promise<{ jobsCount: number; fieldsCount: number }> {
  let cursor: string | null = null;
  let jobsCount = 0;
  let fieldsCount = 0;

  do {
    const data: { jobs: { nodes: JobberJobNode[]; pageInfo: PageInfo } } = await gql(
      accessToken,
      JOBS_QUERY,
      { first: PAGE_SIZE, after: cursor }
    );

    const nodes = data.jobs.nodes;
    if (nodes.length === 0) break;

    for (const j of nodes) {
      console.log(`[sync] job raw:`, JSON.stringify({ id: j.id, createdAt: j.createdAt, completedAt: j.completedAt, jobStatus: j.jobStatus }));
      const jobRow = {
        id: crypto.randomUUID(),
        orgId,
        jobberJobId: j.id,
        jobberClientId: j.client?.id ?? null,
        title: j.title ?? null,
        jobNumber: j.jobNumber ?? null,
        jobStatus: j.jobStatus,
        assignedTo: null,
        instructions: j.instructions?.trim() ?? null,
        createdAt: safeDate(j.createdAt) ?? new Date(),
        completedAt: safeDate(j.completedAt),
      };

      const [upsertedJob] = await db
        .insert(jobs)
        .values(jobRow)
        .onConflictDoUpdate({
          target: [jobs.orgId, jobs.jobberJobId],
          set: {
            title: jobRow.title,
            jobNumber: jobRow.jobNumber,
            jobStatus: jobRow.jobStatus,
            assignedTo: jobRow.assignedTo,
            instructions: jobRow.instructions,
            completedAt: jobRow.completedAt,
            jobberClientId: jobRow.jobberClientId,
          },
        })
        .returning({ id: jobs.id });

      const internalJobId = upsertedJob.id;

      // Line items — delete existing then insert fresh
      if (j.lineItems.nodes.length > 0) {
        await db.delete(jobLineItems).where(eq(jobLineItems.jobId, internalJobId));
        for (const li of j.lineItems.nodes) {
          if (!li.name) continue;
          const qty = Number(li.quantity);
          const price = Number(li.unitPrice);
          await db.insert(jobLineItems).values({
            id: crypto.randomUUID(),
            jobId: internalJobId,
            name: li.name,
            quantity: String(qty),
            unitPrice: String(price),
            total: String(qty * price),
          });
        }
      }

      for (const cf of j.customFields) {
        if (!cf.label) continue;

        await db
          .insert(jobCustomFields)
          .values({
            id: crypto.randomUUID(),
            jobId: internalJobId,
            fieldLabel: cf.label,
            fieldValue: customFieldValue(cf),
          })
          .onConflictDoUpdate({
            target: [jobCustomFields.jobId, jobCustomFields.fieldLabel],
            set: { fieldValue: customFieldValue(cf) },
          });

        fieldsCount++;
      }

      jobsCount++;
    }

    cursor = data.jobs.pageInfo.endCursor;
    console.log(`[sync] jobs page done, total so far: ${jobsCount}`);
  } while (cursor);

  return { jobsCount, fieldsCount };
}

// ---------- Public entry point ----------

export interface SyncResult {
  clientsUpserted: number;
  jobsUpserted: number;
  customFieldsUpserted: number;
}

export async function syncOrg(jobberAccountId: string): Promise<SyncResult> {
  const [org] = await db
    .select()
    .from(jobberOrgs)
    .where(eq(jobberOrgs.jobberAccountId, jobberAccountId))
    .limit(1);

  if (!org) throw new Error(`Org not found: ${jobberAccountId}`);

  const accessToken = await getValidToken(jobberAccountId);

  // Warm up the Jobber API connection before the heavy sync queries
  console.log(`[sync] warming up Jobber API connection...`);
  await gql(accessToken, "{ account { name } }").catch(() => {});
  await new Promise((r) => setTimeout(r, 5000));
  console.log(`[sync] starting sync for org ${org.id}`);

  const clientsUpserted = await syncClients(accessToken, org.id);
  const { jobsCount, fieldsCount } = await syncJobs(accessToken, org.id);

  console.log(`[sync] complete — clients: ${clientsUpserted}, jobs: ${jobsCount}, custom fields: ${fieldsCount}`);

  return {
    clientsUpserted,
    jobsUpserted: jobsCount,
    customFieldsUpserted: fieldsCount,
  };
}
