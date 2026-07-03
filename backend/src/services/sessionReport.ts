import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/errors";
import { fetchKlines } from "./binance/rest";
import { computePerformanceMetrics, fillsToReportFills } from "./backtestAnalytics";
import { paperTradingManager } from "./paperTradingService";
import {
  buildEquityCurveFromKlines,
  dbTradeToFill,
  LIVE_SESSION_SAMPLE_INTERVAL,
  MS_PER_DAY,
  quoteFromPair,
  REPORT_SCHEMA_VERSION,
  type StrategyReport,
} from "./reportShared";

/**
 * Assembles the standardized export JSON for a paper or testnet live session.
 * Works for running and stopped sessions (period end = now or stoppedAt).
 */
export async function buildSessionReport(sessionId: number): Promise<StrategyReport> {
  const session = await prisma.paperSession.findUnique({
    where: { id: sessionId },
    include: {
      config: { include: { strategy: true } },
      trades: { orderBy: { executedAt: "asc" } },
    },
  });

  if (!session) throw new HttpError(404, `Session ${sessionId} not found`);

  const params = session.config.params as Record<string, unknown>;
  const pair = String(params.pair ?? "UNKNOWN");
  const fills = session.trades.map(dbTradeToFill);
  const initialBalance = Number(session.initialBalance);
  const feeRate = Number(session.feeRate ?? 0.001);

  const periodStartMs = session.startedAt.getTime();
  const periodEndMs = (session.stoppedAt ?? new Date()).getTime();

  const candles = await fetchKlines(
    pair,
    LIVE_SESSION_SAMPLE_INTERVAL,
    periodStartMs,
    periodEndMs
  );
  const closes = candles.length > 0 ? candles.map((c) => c.close) : [];

  const live = paperTradingManager.getLiveState(sessionId);
  const quoteBalance = live ? live.quoteBalance : Number(session.quoteBalance);
  const baseBalance = live ? live.baseBalance : Number(session.baseBalance);

  let firstPrice = closes[0];
  let lastPrice = live?.currentPrice ?? closes[closes.length - 1];

  if (firstPrice === undefined) {
    firstPrice = fills[0]?.price ?? lastPrice ?? 0;
  }
  if (lastPrice === undefined) {
    lastPrice = fills[fills.length - 1]?.price ?? firstPrice;
  }
  if (closes.length === 0 && firstPrice > 0) {
    closes.push(firstPrice, lastPrice);
  }

  const finalEquity =
    live?.equity ?? quoteBalance + baseBalance * lastPrice;

  const equityCurve = buildEquityCurveFromKlines(initialBalance, fills, candles);
  if (equityCurve.length > 0) {
    equityCurve[equityCurve.length - 1] = {
      timestamp: periodEndMs,
      equity: finalEquity,
    };
  }

  const { performance, benchmark, marketRegime, roundTrips, openPositions } =
    computePerformanceMetrics({
      initialBalance,
      finalEquity,
      feeRate,
      equityCurve,
      fills,
      interval: LIVE_SESSION_SAMPLE_INTERVAL,
      periodStartMs,
      periodEndMs,
      firstPrice,
      lastPrice,
      closes,
    });

  const isTestnet = session.kind === "live_testnet";
  const notes: string[] = [
    "Live session report — equity curve is sampled on 1h candles from session start to export time.",
    isTestnet
      ? "Fills are real MARKET orders on the Binance Spot Testnet; intended vs filled price may differ."
      : "Fills are simulated locally against live production WebSocket prices.",
    "Exit reason is always 'signal' — stop-loss and take-profit orders are not implemented.",
    "Round trips are FIFO-matched sells to prior buys; open buys at period end appear under openPositions.",
    "Sharpe and Sortino use equity-curve period returns with risk-free rate = 0.",
    "Buy-and-hold assumes one entry fee at session start and holds to the final price (no exit fee).",
  ];

  if (session.status === "running") {
    notes.push(
      "Session is still running — metrics reflect the snapshot at export time and will change as trading continues."
    );
  }

  if (roundTrips.length === 0 && fills.some((f) => f.side === "buy")) {
    notes.push(
      "No completed round trips — win rate, profit factor, and trade-duration metrics are null or refer only to open positions."
    );
  }

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    reportType: "live_session",
    generatedAt: new Date().toISOString(),
    runMetadata: {
      reportType: "live_session",
      sessionId: session.id,
      sessionKind: session.kind as "paper" | "live_testnet",
      createdAt: session.startedAt.toISOString(),
      status: session.status,
      strategy: {
        name: session.config.strategy.name,
        slug: session.config.strategy.slug,
        version: "1.0",
        riskLevel: session.config.strategy.riskLevel,
      },
      symbol: pair,
      interval: LIVE_SESSION_SAMPLE_INTERVAL,
      period: {
        start: session.startedAt.toISOString(),
        end: new Date(periodEndMs).toISOString(),
        durationDays: (periodEndMs - periodStartMs) / MS_PER_DAY,
      },
      initialCapital: initialBalance,
      assumptions: {
        feeRate,
        feeRatePct: feeRate * 100,
        slippageBps: 0,
        fillModel: isTestnet ? "testnet_market" : "live_simulated",
        quoteCurrency: quoteFromPair(pair),
      },
    },
    strategyParameters: params,
    performance,
    benchmark,
    marketRegime,
    tradeLog: {
      roundTrips,
      openPositions,
      fills: fillsToReportFills(fills),
    },
    equityCurve,
    notes,
  };
}
