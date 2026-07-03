import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { paperTradingManager } from "../services/paperTradingService";
import { buildSessionReport } from "../services/sessionReport";

export const paperSessionsRouter = Router();

const createSessionSchema = z.object({
  configId: z.number().int().positive(),
  initialBalance: z.number().positive().default(10_000),
  feeRate: z.number().min(0).max(0.01).default(0.001),
  // live_real is deliberately not accepted here yet — that's Phase 13.
  kind: z.enum(["paper", "live_testnet"]).default("paper"),
});

paperSessionsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }

    const session = await paperTradingManager.startSession(
      parsed.data.configId,
      parsed.data.initialBalance,
      parsed.data.feeRate,
      parsed.data.kind
    );
    res.status(201).json(session);
  })
);

paperSessionsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const sessions = await prisma.paperSession.findMany({
      orderBy: { startedAt: "desc" },
      include: { config: { include: { strategy: { select: { slug: true, name: true } } } } },
    });
    res.json(sessions);
  })
);

paperSessionsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, "Invalid session id");

    const session = await prisma.paperSession.findUnique({
      where: { id },
      include: { config: { include: { strategy: { select: { slug: true, name: true } } } } },
    });
    if (!session) throw new HttpError(404, `Session ${id} not found`);

    // live is null while stopped, or in the first moments before the first
    // price tick arrives; the DB row alone is still a valid snapshot.
    const live = paperTradingManager.getLiveState(id);
    const unrealizedPnl = live ? live.equity - Number(session.initialBalance) : null;
    res.json({ ...session, live, unrealizedPnl });
  })
);

paperSessionsRouter.post(
  "/:id/stop",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, "Invalid session id");

    const session = await paperTradingManager.stopSession(id);
    res.json(session);
  })
);

paperSessionsRouter.get(
  "/:id/export",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, "Invalid session id");

    const report = await buildSessionReport(id);
    const filename = `session-${id}-report.json`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.json(report);
  })
);

paperSessionsRouter.get(
  "/:id/trades",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, "Invalid session id");

    const trades = await prisma.simulatedTrade.findMany({
      where: { paperSessionId: id },
      orderBy: { executedAt: "asc" },
    });
    res.json(trades);
  })
);
