import "dotenv/config";
import express from "express";
import cors from "cors";
import authRouter from "./routes/auth";
import apiRouter from "./routes/api";
import webhookRouter from "./routes/webhooks";

// Extend Request type to carry the raw body buffer for HMAC verification
declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

const app = express();
const PORT = process.env.PORT ?? 3001;

const allowedOrigins = [
  "http://localhost:3000",
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

app.use(cors({ origin: allowedOrigins, credentials: true }));

// Capture raw body on every request before JSON parsing so webhook HMAC
// verification always has the original bytes regardless of route order.
app.use(
  express.json({
    verify: (_req, _res, buf) => {
      (_req as express.Request).rawBody = buf;
    },
  })
);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth/jobber", authRouter);
app.use("/api", apiRouter);

app.listen(PORT, () => {
  console.log(`AssetMinder backend running on port ${PORT}`);
});
