import "dotenv/config";
import express from "express";
import cors from "cors";
import authRouter from "./routes/auth";
import apiRouter from "./routes/api";
import webhookRouter from "./routes/webhooks";

const app = express();
const PORT = process.env.PORT ?? 3001;

const allowedOrigins = [
  "http://localhost:3000",
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

app.use(cors({ origin: allowedOrigins, credentials: true }));

// Webhook route must be registered BEFORE express.json() so it receives
// the raw request body buffer needed for HMAC signature verification.
app.use("/api/webhooks", webhookRouter);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth/jobber", authRouter);
app.use("/api", apiRouter);

app.listen(PORT, () => {
  console.log(`AssetMinder backend running on port ${PORT}`);
});
