import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/errors";
import { getStrategyDefinition } from "../strategies";
import type { PricePoint, StrategyInstance } from "../strategies/types";
import { fetchKlines } from "./binance/rest";
import { computePerformanceMetrics } from "./backtestAnalytics";
import { DEFAULT_FEE_RATE, runSimulation } from "./simulation";

export interface BacktestRequest {
  configId: number;
  startDate: Date;
  endDate: Date;
  interval: string;
  initialBalance: number;
  feeRate: number;
  slippageBps: number;
}

const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

function toPoints(candles: { close: number; closeTime: number }[]): PricePoint[] {
  // Trades execute at each candle's close: by close time the price is known,
  // so the strategy never acts on information from the future.
  return candles.map((c) => ({ price: c.close, timestamp: c.closeTime }));
}

/**
 * Feeds pre-start history to an indicator strategy so its buffers are primed
 * when the real backtest begins. Decisions during warm-up are discarded — the
 * account doesn't exist yet.
 */
async function warmUp(
  instance: StrategyInstance,
  warmupCandles: number,
  pair: string,
  interval: string,
  startMs: number
) {
  const intervalMs = INTERVAL_MS[interval] ?? 60 * 60_000;
  const warmupStart = startMs - warmupCandles * intervalMs;
  const candles = await fetchKlines(pair, interval, warmupStart, startMs - 1);
  for (const point of toPoints(candles)) {
    instance.onPrice(point, { quoteBalance: 0, baseBalance: 0 });
  }
}

/**
 * Runs a backtest end-to-end: load config → fetch candles → simulate → persist.
 * Synchronous by design for the MVP (a few seconds at 1h granularity); the
 * pending/failed status still exists so this can become a background job later
 * without a schema change.
 */
export async function runBacktest(request: BacktestRequest) {
  const config = await prisma.strategyConfig.findUnique({
    where: { id: request.configId },
    include: { strategy: true },
  });
  if (!config) throw new HttpError(404, `Config ${request.configId} not found`);

  const definition = getStrategyDefinition(config.strategy.slug);
  if (!definition) {
    throw new HttpError(500, `No implementation registered for strategy '${config.strategy.slug}'`);
  }

  const params = definition.paramsSchema.parse(config.params);
  const pair = (params as { pair: string }).pair;

  const run = await prisma.backtestRun.create({
    data: {
      configId: config.id,
      startDate: request.startDate,
      endDate: request.endDate,
      interval: request.interval,
      status: "pending",
    },
  });

  try {
    const candles = await fetchKlines(
      pair,
      request.interval,
      request.startDate.getTime(),
      request.endDate.getTime()
    );
    if (candles.length === 0) {
      throw new Error("Binance returned no candles for this range");
    }

    const points = toPoints(candles);
    const instance = definition.create(params as never, points[0].timestamp);

    const warmupCandles =
      typeof definition.warmupCandles === "function"
        ? definition.warmupCandles(params as never)
        : definition.warmupCandles ?? 0;
    if (warmupCandles > 0) {
      await warmUp(instance, warmupCandles, pair, request.interval, points[0].timestamp);
    }

    const result = runSimulation(instance, points, request.initialBalance, {
      feeRate: request.feeRate ?? DEFAULT_FEE_RATE,
      slippageBps: request.slippageBps ?? 0,
    });

    const firstPrice = candles[0].close;
    const lastPrice = candles[candles.length - 1].close;
    const closes = candles.map((c) => c.close);
    const periodStartMs = request.startDate.getTime();
    const periodEndMs = request.endDate.getTime();

    const analytics = computePerformanceMetrics({
      initialBalance: request.initialBalance,
      finalEquity: result.finalEquity,
      feeRate: result.feeRate,
      equityCurve: result.equityCurve,
      fills: result.trades,
      interval: request.interval,
      periodStartMs,
      periodEndMs,
      firstPrice,
      lastPrice,
      closes,
    });

    const { trades, ...summary } = result;
    const enrichedSummary = {
      ...summary,
      firstPrice,
      lastPrice,
      performance: analytics.performance,
      benchmark: analytics.benchmark,
      marketRegime: analytics.marketRegime,
    };

    const [, completed] = await prisma.$transaction([
      prisma.simulatedTrade.createMany({
        data: trades.map((t) => ({
          backtestRunId: run.id,
          side: t.side,
          price: t.price,
          quantity: t.quantity,
          quoteAmount: t.quoteAmount,
          fee: t.fee,
          executedAt: new Date(t.executedAt),
        })),
      }),
      prisma.backtestRun.update({
        where: { id: run.id },
        data: { status: "completed", results: JSON.parse(JSON.stringify(enrichedSummary)) },
      }),
    ]);

    return completed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.backtestRun.update({
      where: { id: run.id },
      data: { status: "failed", error: message },
    });
    throw new HttpError(502, `Backtest failed: ${message}`);
  }
}
