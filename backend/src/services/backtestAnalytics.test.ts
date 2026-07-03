import { describe, expect, it } from "vitest";
import {
  buildRoundTrips,
  classifyMarketRegime,
  computeBenchmark,
  computePerformanceMetrics,
} from "./backtestAnalytics";
import type { EquitySample, SimulatedFill } from "./simulation";

const DAY_MS = 86_400_000;

function fill(
  side: "buy" | "sell",
  price: number,
  quantity: number,
  day: number,
  fee = 0
): SimulatedFill {
  return {
    side,
    price,
    quantity,
    quoteAmount: price * quantity,
    fee,
    executedAt: day * DAY_MS,
  };
}

describe("buildRoundTrips", () => {
  it("matches a profitable sell to its buy with fees", () => {
    const fills = [
      fill("buy", 100, 1, 0, 0.1),
      fill("sell", 120, 1, 5, 0.12),
    ];
    const { roundTrips, openPositions } = buildRoundTrips(fills, 0.001, 120);

    expect(roundTrips).toHaveLength(1);
    expect(roundTrips[0].netPnl).toBeCloseTo(120 - 0.12 - 100 - 0.1, 6);
    expect(roundTrips[0].exitReason).toBe("signal");
    expect(openPositions).toHaveLength(0);
  });

  it("tracks open positions when buys are not sold", () => {
    const fills = [fill("buy", 100, 2, 0, 0.2)];
    const { roundTrips, openPositions } = buildRoundTrips(fills, 0.001, 120);

    expect(roundTrips).toHaveLength(0);
    expect(openPositions).toHaveLength(1);
    expect(openPositions[0].quantity).toBe(2);
  });
});

describe("computeBenchmark", () => {
  it("computes buy-and-hold with entry fee", () => {
    const b = computeBenchmark(10_000, 50_000, 60_000, 0.001, 5);
    const coins = (10_000 * 0.999) / 50_000;
    expect(b.buyAndHoldFinalEquity).toBeCloseTo(coins * 60_000, 4);
    expect(b.buyAndHoldReturnPct).toBeCloseTo(
      ((b.buyAndHoldFinalEquity - 10_000) / 10_000) * 100,
      4
    );
    expect(b.excessReturnPct).toBeCloseTo(5 - b.buyAndHoldReturnPct, 4);
  });
});

describe("classifyMarketRegime", () => {
  it("labels a strong rally as trending_up", () => {
    const closes = [100, 105, 110, 115, 120];
    const regime = classifyMarketRegime(closes, "1d", 30 * DAY_MS);
    expect(regime.label).toBe("trending_up");
    expect(regime.priceReturnPct).toBeCloseTo(20, 4);
  });
});

describe("computePerformanceMetrics", () => {
  it("computes drawdown on a simple equity curve", () => {
    const equityCurve: EquitySample[] = [
      { timestamp: 0, equity: 1000 },
      { timestamp: DAY_MS, equity: 1100 },
      { timestamp: 2 * DAY_MS, equity: 900 },
      { timestamp: 3 * DAY_MS, equity: 1050 },
    ];
    const fills = [
      fill("buy", 100, 1, 0, 0),
      fill("sell", 110, 1, 1, 0),
      fill("buy", 90, 1, 2, 0),
      fill("sell", 105, 1, 3, 0),
    ];

    const result = computePerformanceMetrics({
      initialBalance: 1000,
      finalEquity: 1050,
      feeRate: 0,
      equityCurve,
      fills,
      interval: "1d",
      periodStartMs: 0,
      periodEndMs: 3 * DAY_MS,
      firstPrice: 100,
      lastPrice: 105,
      closes: [100, 110, 90, 105],
    });

    expect(result.performance.maxDrawdownPct).toBeCloseTo((200 / 1100) * 100, 4);
    expect(result.performance.roundTripCount).toBe(2);
    expect(result.performance.fillCount).toBe(4);
    expect(result.benchmark.beatBuyAndHold).toBeDefined();
  });
});
