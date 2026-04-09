import "dotenv/config";
import express from "express";
import cors from "cors";
import authRouter from "./routes/auth";
import apiRouter from "./routes/api";

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth/jobber", authRouter);
app.use("/api", apiRouter);

app.listen(PORT, () => {
  console.log(`AssetMinder backend running on port ${PORT}`);
});
