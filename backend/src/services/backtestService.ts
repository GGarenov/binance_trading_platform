import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/errors";
import { getStrategyDefinition } from "../strategies";
import type { PricePoint } from "../strategies/types";
import { fetchKlines } from "./binance/rest";
import { runSimulation } from "./simulation";

export interface BacktestRequest {
  configId: number;
  startDate: Date;
  endDate: Date;
  interval: string;
  initialBalance: number;
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
      (params as { pair: string }).pair,
      request.interval,
      request.startDate.getTime(),
      request.endDate.getTime()
    );
    if (candles.length === 0) {
      throw new Error("Binance returned no candles for this range");
    }

    // Trades execute at each candle's close: by close time the price is known,
    // so the strategy never acts on information from the future.
    const points: PricePoint[] = candles.map((c) => ({
      price: c.close,
      timestamp: c.closeTime,
    }));

    const instance = definition.create(params as never, points[0].timestamp);
    const result = runSimulation(instance, points, request.initialBalance);

    const { trades, ...summary } = result;

    const [, completed] = await prisma.$transaction([
      prisma.simulatedTrade.createMany({
        data: trades.map((t) => ({
          backtestRunId: run.id,
          side: t.side,
          price: t.price,
          quantity: t.quantity,
          quoteAmount: t.quoteAmount,
          executedAt: new Date(t.executedAt),
        })),
      }),
      prisma.backtestRun.update({
        where: { id: run.id },
        data: { status: "completed", results: JSON.parse(JSON.stringify(summary)) },
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
