import "dotenv/config";
import express from "express";
import cors from "cors";
import authRouter from "./routes/auth";
import apiRouter from "./routes/api";

const app = express();
const PORT = process.env.PORT ?? 3001;

const allowedOrigins = [
  "http://localhost:3000",
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth/jobber", authRouter);
app.use("/api", apiRouter);

app.listen(PORT, () => {
  console.log(`AssetMinder backend running on port ${PORT}`);
});
