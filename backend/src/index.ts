import "dotenv/config";
import express from "express";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import authRouter from "./routes/auth";
import apiRouter from "./routes/api";
import webhookRouter from "./routes/webhooks";

const app = express();
const PORT = process.env.PORT ?? 3001;

const allowedOrigins = [
  "http://localhost:3000",
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

app.set("trust proxy", 1);
app.use(cors({ origin: allowedOrigins, credentials: true }));

// Raw body capture for webhook HMAC — MUST be before express.json()
app.use("/api/webhooks/jobber", express.raw({ type: "application/json" }));

app.use(express.json());

// Rate limiting — sync is the most expensive operation
const syncLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  limit: 5,                  // max 5 syncs per 5 minutes per IP
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many sync requests. Please wait before syncing again." },
});
app.use("/api/sync", syncLimiter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth/jobber", authRouter);
app.use("/api/webhooks", webhookRouter); // must be before /api to avoid express.json() conflict
app.use("/api", apiRouter);

app.listen(PORT, () => {
  console.log(`AssetMinder backend running on port ${PORT}`);
});
