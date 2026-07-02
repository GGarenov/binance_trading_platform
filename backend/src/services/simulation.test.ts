import { describe, expect, it } from "vitest";
import { runSimulation } from "./simulation";
import { dcaStrategy } from "../strategies/dca";
import { gridStrategy } from "../strategies/grid";
import type { PricePoint } from "../strategies/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function dailyPoints(prices: number[]): PricePoint[] {
  return prices.map((price, i) => ({ price, timestamp: i * DAY_MS }));
}

describe("runSimulation", () => {
  it("computes DCA balances and P&L that can be checked by hand", () => {
    // Daily $100 buys for 2 days => buys at day 0, 1, 2 at prices 100, 200, 400.
    const dca = dcaStrategy.create(
      { pair: "BTCUSDT", amountPerBuy: 100, interval: "daily", durationDays: 2 },
      0
    );
    const result = runSimulation(dca, dailyPoints([100, 200, 400]), 1000);

    // Quantities: 1.0 + 0.5 + 0.25 = 1.75 coins for $300.
    expect(result.finalBaseBalance).toBeCloseTo(1.75, 10);
    expect(result.finalQuoteBalance).toBeCloseTo(700, 10);
    // Final equity: 700 cash + 1.75 × 400 = 1400 → P&L +400 (+40%).
    expect(result.finalEquity).toBeCloseTo(1400, 10);
    expect(result.pnl).toBeCloseTo(400, 10);
    expect(result.pnlPct).toBeCloseTo(40, 10);
    expect(result.tradeCount).toBe(3);
    expect(result.winRate).toBeNull(); // DCA never sells
  });

  it("skips buys the account cannot afford instead of going negative", () => {
    const dca = dcaStrategy.create(
      { pair: "BTCUSDT", amountPerBuy: 60, interval: "daily", durationDays: 5 },
      0
    );
    // Initial balance 100 covers one $60 buy, not two.
    const result = runSimulation(dca, dailyPoints([100, 100, 100]), 100);

    expect(result.tradeCount).toBe(1);
    expect(result.finalQuoteBalance).toBeCloseTo(40, 10);
  });

  it("scores a profitable grid round trip as a win", () => {
    const grid = gridStrategy.create(
      { pair: "BTCUSDT", lowerBound: 100, upperBound: 200, gridLevels: 6, amountPerLevel: 100 },
      0
    );
    // 150 (ref) → 135 buys the 140 level → 165 sells it at a profit.
    const result = runSimulation(grid, dailyPoints([150, 135, 165]), 1000);

    expect(result.tradeCount).toBe(2);
    expect(result.winRate).toBe(1);
    // Bought 100/135 coins, sold at 165: profit = (165 - 135) × (100/135) ≈ 22.22.
    expect(result.pnl).toBeCloseTo((165 - 135) * (100 / 135), 8);
    expect(result.finalBaseBalance).toBeCloseTo(0, 10);
  });

  it("caps the equity curve size but keeps the final sample", () => {
    const dca = dcaStrategy.create(
      { pair: "BTCUSDT", amountPerBuy: 1, interval: "daily", durationDays: 1 },
      0
    );
    const prices = Array.from({ length: 2000 }, () => 100);
    const result = runSimulation(dca, dailyPoints(prices), 1000);

    expect(result.equityCurve.length).toBeLessThanOrEqual(501);
    expect(result.equityCurve[result.equityCurve.length - 1].timestamp).toBe(1999 * DAY_MS);
  });
});
