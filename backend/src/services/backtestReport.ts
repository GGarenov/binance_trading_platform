import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/errors";
import { fetchKlines } from "./binance/rest";
import {
  computePerformanceMetrics,
  fillsToReportFills,
  type BenchmarkComparison,
  type MarketRegimeContext,
  type PerformanceMetrics,
  type ReportOpenPosition,
  type ReportRoundTrip,
} from "./backtestAnalytics";
import type { EquitySample, SimulatedFill } from "./simulation";

/** Bump when the export shape changes in a breaking way. */
export const BACKTEST_REPORT_SCHEMA_VERSION = "1.0";

export interface BacktestReport {
  schemaVersion: string;
  generatedAt: string;
  runMetadata: {
    backtestId: number;
    createdAt: string;
    status: string;
    strategy: {
      name: string;
      slug: string;
      version: string;
      riskLevel: string | null;
    };
    symbol: string;
    interval: string;
    period: {
      start: string;
      end: string;
      durationDays: number;
    };
    initialCapital: number;
    assumptions: {
      feeRate: number;
      feeRatePct: number;
      slippageBps: number;
      fillModel: string;
      quoteCurrency: string;
    };
  };
  strategyParameters: Record<string, unknown>;
  performance: PerformanceMetrics;
  benchmark: BenchmarkComparison;
  marketRegime: MarketRegimeContext;
  tradeLog: {
    roundTrips: ReportRoundTrip[];
    openPositions: ReportOpenPosition[];
    fills: ReturnType<typeof fillsToReportFills>;
  };
  equityCurve: EquitySample[];
  notes: string[];
}

const MS_PER_DAY = 86_400_000;

function dbTradeToFill(t: {
  side: string;
  price: { toString(): string };
  quantity: { toString(): string };
  quoteAmount: { toString(): string };
  fee: { toString(): string };
  executedAt: Date;
}): SimulatedFill {
  return {
    side: t.side as "buy" | "sell",
    price: Number(t.price),
    quantity: Number(t.quantity),
    quoteAmount: Number(t.quoteAmount),
    fee: Number(t.fee),
    executedAt: t.executedAt.getTime(),
  };
}

function quoteFromPair(pair: string): string {
  if (pair.endsWith("USDC")) return "USDC";
  if (pair.endsWith("USDT")) return "USDT";
  return "QUOTE";
}

function parseStoredResults(raw: unknown): {
  initialBalance: number;
  feeRate: number;
  slippageBps: number;
  finalEquity: number;
  equityCurve: EquitySample[];
  firstPrice?: number;
  lastPrice?: number;
} {
  const r = raw as Record<string, unknown>;
  return {
    initialBalance: Number(r.initialBalance),
    feeRate: Number(r.feeRate ?? 0.001),
    slippageBps: Number(r.slippageBps ?? 0),
    finalEquity: Number(r.finalEquity),
    equityCurve: (r.equityCurve as EquitySample[]) ?? [],
    firstPrice: r.firstPrice !== undefined ? Number(r.firstPrice) : undefined,
    lastPrice: r.lastPrice !== undefined ? Number(r.lastPrice) : undefined,
  };
}

/**
 * Assembles the standardized backtest export JSON for download / AI analysis.
 * Recomputes analytics from stored trades when extended metrics are missing.
 */
export async function buildBacktestReport(backtestId: number): Promise<BacktestReport> {
  const run = await prisma.backtestRun.findUnique({
    where: { id: backtestId },
    include: {
      config: { include: { strategy: true } },
      trades: { orderBy: { executedAt: "asc" } },
    },
  });

  if (!run) throw new HttpError(404, `Backtest ${backtestId} not found`);
  if (run.status !== "completed" || !run.results) {
    throw new HttpError(400, "Report is only available for completed backtests");
  }

  const params = run.config.params as Record<string, unknown>;
  const pair = String(params.pair ?? "UNKNOWN");
  const stored = parseStoredResults(run.results);
  const fills = run.trades.map(dbTradeToFill);

  let firstPrice = stored.firstPrice;
  let lastPrice = stored.lastPrice;
  let closes: number[] = [];

  if (firstPrice === undefined || lastPrice === undefined) {
    const candles = await fetchKlines(
      pair,
      run.interval,
      run.startDate.getTime(),
      run.endDate.getTime()
    );
    if (candles.length > 0) {
      closes = candles.map((c) => c.close);
      firstPrice = candles[0].close;
      lastPrice = candles[candles.length - 1].close;
    } else {
      firstPrice = fills[0]?.price ?? 0;
      lastPrice = fills[fills.length - 1]?.price ?? firstPrice;
      closes = [firstPrice, lastPrice];
    }
  } else {
    const candles = await fetchKlines(
      pair,
      run.interval,
      run.startDate.getTime(),
      run.endDate.getTime()
    );
    closes = candles.length > 0 ? candles.map((c) => c.close) : [firstPrice, lastPrice];
  }

  const periodStartMs = run.startDate.getTime();
  const periodEndMs = run.endDate.getTime();

  const { performance, benchmark, marketRegime, roundTrips, openPositions } =
    computePerformanceMetrics({
      initialBalance: stored.initialBalance,
      finalEquity: stored.finalEquity,
      feeRate: stored.feeRate,
      equityCurve: stored.equityCurve,
      fills,
      interval: run.interval,
      periodStartMs,
      periodEndMs,
      firstPrice,
      lastPrice,
      closes,
    });

  const notes: string[] = [
    "Fills execute at candle close with no lookahead.",
    "Exit reason is always 'signal' — stop-loss and take-profit orders are not implemented.",
    "Round trips are FIFO-matched sells to prior buys; open buys at period end appear under openPositions.",
    "Sharpe and Sortino use equity-curve period returns with risk-free rate = 0.",
    "Buy-and-hold assumes one entry fee at the start and holds to the final close (no exit fee).",
  ];

  if (roundTrips.length === 0 && fills.some((f) => f.side === "buy")) {
    notes.push(
      "No completed round trips — win rate, profit factor, and trade-duration metrics are null or refer only to open positions."
    );
  }

  return {
    schemaVersion: BACKTEST_REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    runMetadata: {
      backtestId: run.id,
      createdAt: run.createdAt.toISOString(),
      status: run.status,
      strategy: {
        name: run.config.strategy.name,
        slug: run.config.strategy.slug,
        version: "1.0",
        riskLevel: run.config.strategy.riskLevel,
      },
      symbol: pair,
      interval: run.interval,
      period: {
        start: run.startDate.toISOString(),
        end: run.endDate.toISOString(),
        durationDays: (periodEndMs - periodStartMs) / MS_PER_DAY,
      },
      initialCapital: stored.initialBalance,
      assumptions: {
        feeRate: stored.feeRate,
        feeRatePct: stored.feeRate * 100,
        slippageBps: stored.slippageBps,
        fillModel: "candle_close",
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
    equityCurve: stored.equityCurve,
    notes,
  };
}
