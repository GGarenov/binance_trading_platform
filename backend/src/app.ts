import express from "express";
import cors from "cors";
import { errorHandler } from "./lib/errors";
import { backtestsRouter } from "./routes/backtests";
import { configsRouter } from "./routes/configs";
import { marketRouter } from "./routes/market";
import { paperSessionsRouter } from "./routes/paperSessions";
import { strategiesRouter } from "./routes/strategies";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/market", marketRouter);
  app.use("/api/strategies", strategiesRouter);
  app.use("/api/configs", configsRouter);
  app.use("/api/backtests", backtestsRouter);
  app.use("/api/paper-sessions", paperSessionsRouter);

  // Registered last so it catches errors thrown by any route above.
  app.use(errorHandler);

  return app;
}
