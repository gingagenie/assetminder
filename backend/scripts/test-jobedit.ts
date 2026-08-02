import "dotenv/config";
import { eq, isNotNull } from "drizzle-orm";
import { db } from "../src/db/client";
import { jobberOrgs, jobs } from "../src/db/schema";
import { getValidToken } from "../src/lib/jobberToken";

const URL = "https://api.getjobber.com/api/graphql";
const VER = "2025-04-16";

async function gql(t: string, q: string) {
  const r = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}`, "X-JOBBER-GRAPHQL-VERSION": VER },
    body: JSON.stringify({ query: q }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt}`);
  const j = JSON.parse(txt);
  if (j.errors?.length) throw new Error(`GraphQL errors: ${JSON.stringify(j.errors)}`);
  return j.data;
}

async function main() {
  const [org] = await db.select().from(jobberOrgs).where(isNotNull(jobberOrgs.assetIdentifierFieldId)).limit(1);
  if (!org) throw new Error("No org with assetIdentifierFieldId set");
  console.log(`Org: ${org.jobberAccountId}`);
  console.log(`Field: ${org.assetIdentifierField}  config id: ${org.assetIdentifierFieldId}`);

  const [job] = await db.select().from(jobs).where(eq(jobs.orgId, org.id)).limit(1);
  if (!job) throw new Error("No jobs found for org");
  console.log(`Test job: jobberJobId ${job.jobberJobId}  #${job.jobNumber}`);

  const token = await getValidToken(org.jobberAccountId);

  const read = await gql(token, `
    { job(id: ${JSON.stringify(job.jobberJobId)}) {
        id jobNumber
        customFields { ... on CustomFieldText { label valueText } }
    } }
  `);
  const cfs = read?.job?.customFields ?? [];
  const current: string = cfs.find((c: any) => c.label === org.assetIdentifierField)?.valueText ?? "";
  console.log(`Current Asset ID value: ${JSON.stringify(current)}`);

  const mutation = `
    mutation {
      jobEdit(
        jobId: ${JSON.stringify(job.jobberJobId)}
        input: { customFields: [ { id: ${JSON.stringify(org.assetIdentifierFieldId)}, valueText: ${JSON.stringify(current)} } ] }
      ) { job { id jobNumber } userErrors { message path } }
    }
  `;
  console.log("\n--- Running live jobEdit (no-op: same value) ---");
  const data = await gql(token, mutation);
  console.log(JSON.stringify(data, null, 2));

  const errs = data?.jobEdit?.userErrors ?? [];
  if (errs.length) console.log(`\nRESULT: userErrors -> ${errs.map((e: any) => e.message).join(", ")}`);
  else if (data?.jobEdit?.job?.id) console.log(`\nRESULT: SUCCESS — write_jobs is active. jobEdit returned job ${data.jobEdit.job.id} (#${data.jobEdit.job.jobNumber}). Value unchanged.`);
  else console.log("\nRESULT: Unexpected response shape.");
  process.exit(0);
}

main().catch((e) => { console.error("\nFAILED:", String(e)); process.exit(1); });
