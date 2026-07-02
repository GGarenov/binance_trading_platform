import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { runBacktest } from "../services/backtestService";

export const backtestsRouter = Router();

const createBacktestSchema = z.object({
  configId: z.number().int().positive(),
  // ISO strings from the frontend, e.g. "2026-06-01T00:00:00Z".
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  interval: z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]).default("1h"),
  initialBalance: z.number().positive().default(10_000),
});

backtestsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createBacktestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    if (parsed.data.startDate >= parsed.data.endDate) {
      throw new HttpError(400, "startDate must be before endDate");
    }

    const run = await runBacktest(parsed.data);
    res.status(201).json(run);
  })
);

backtestsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, "Invalid backtest id");

    const run = await prisma.backtestRun.findUnique({
      where: { id },
      include: { config: { include: { strategy: { select: { slug: true, name: true } } } } },
    });
    if (!run) throw new HttpError(404, `Backtest ${id} not found`);
    res.json(run);
  })
);

backtestsRouter.get(
  "/:id/trades",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, "Invalid backtest id");

    const trades = await prisma.simulatedTrade.findMany({
      where: { backtestRunId: id },
      orderBy: { executedAt: "asc" },
    });
    res.json(trades);
  })
);
