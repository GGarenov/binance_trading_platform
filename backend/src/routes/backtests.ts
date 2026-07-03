import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { runBacktest } from "../services/backtestService";
import { buildBacktestReport } from "../services/backtestReport";

export const backtestsRouter = Router();

const createBacktestSchema = z.object({
  configId: z.number().int().positive(),
  // ISO strings from the frontend, e.g. "2026-06-01T00:00:00Z".
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  interval: z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]).default("1h"),
  initialBalance: z.number().positive().default(10_000),
  // 0.001 = 0.10% per fill (Binance spot standard). Allow 0 for "ideal world"
  // comparisons, cap at 1% to catch unit mistakes (e.g. passing 0.1 for 0.1%).
  feeRate: z.number().min(0).max(0.01).default(0.001),
  slippageBps: z.number().min(0).max(100).default(0),
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

    const run = await runBacktest({
      ...parsed.data,
      // zod defaults guarantee these are set; spelled out for the service type.
      feeRate: parsed.data.feeRate,
      slippageBps: parsed.data.slippageBps,
    });
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
  "/:id/export",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, "Invalid backtest id");

    const report = await buildBacktestReport(id);
    const filename = `backtest-${id}-report.json`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.json(report);
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
