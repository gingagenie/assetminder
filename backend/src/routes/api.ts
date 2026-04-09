import { Router, Request, Response } from "express";
import { getValidToken } from "../lib/jobberToken";

const router = Router();

const JOBBER_GRAPHQL_URL = "https://api.getjobber.com/api/graphql";
const JOBBER_API_VERSION = "2025-04-16";

router.get("/me", async (req: Request, res: Response) => {
  const { jobberAccountId } = req.query;

  if (!jobberAccountId || typeof jobberAccountId !== "string") {
    res.status(400).json({ error: "Missing required query param: jobberAccountId" });
    return;
  }

  const accessToken = await getValidToken(jobberAccountId);

  const gqlRes = await fetch(JOBBER_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-JOBBER-GRAPHQL-VERSION": JOBBER_API_VERSION,
    },
    body: JSON.stringify({
      query: `{ account { name } }`,
    }),
  });

  if (!gqlRes.ok) {
    const detail = await gqlRes.text();
    res.status(502).json({ error: "Jobber GraphQL request failed", detail });
    return;
  }

  const data = (await gqlRes.json()) as { data: { account: { name: string } } };

  res.json({ accountName: data.data.account.name });
});

export default router;
