import { describe, expect, it } from "vitest";
import { runSimulation, type ExecutionOptions } from "./simulation";
import { dcaStrategy } from "../strategies/dca";
import { gridStrategy } from "../strategies/grid";
import type { PricePoint } from "../strategies/types";

const DAY_MS = 24 * 60 * 60 * 1000;

const NO_FEES: ExecutionOptions = { feeRate: 0, slippageBps: 0 };
const BINANCE_FEES: ExecutionOptions = { feeRate: 0.001, slippageBps: 0 };

function dailyPoints(prices: number[]): PricePoint[] {
  return prices.map((price, i) => ({ price, timestamp: i * DAY_MS }));
}

describe("runSimulation (ideal world: no fees)", () => {
  it("computes DCA balances and P&L that can be checked by hand", () => {
    // Daily $100 buys for 2 days => buys at day 0, 1, 2 at prices 100, 200, 400.
    const dca = dcaStrategy.create(
      { pair: "BTCUSDT", amountPerBuy: 100, interval: "daily", durationDays: 2 },
      0
    );
    const result = runSimulation(dca, dailyPoints([100, 200, 400]), 1000, NO_FEES);

    // Quantities: 1.0 + 0.5 + 0.25 = 1.75 coins for $300.
    expect(result.finalBaseBalance).toBeCloseTo(1.75, 10);
    expect(result.finalQuoteBalance).toBeCloseTo(700, 10);
    // Final equity: 700 cash + 1.75 × 400 = 1400 → P&L +400 (+40%).
    expect(result.finalEquity).toBeCloseTo(1400, 10);
    expect(result.pnl).toBeCloseTo(400, 10);
    expect(result.pnlPct).toBeCloseTo(40, 10);
    expect(result.tradeCount).toBe(3);
    expect(result.feesPaid).toBe(0);
    expect(result.winRate).toBeNull(); // DCA never sells
  });

  it("skips buys the account cannot afford instead of going negative", () => {
    const dca = dcaStrategy.create(
      { pair: "BTCUSDT", amountPerBuy: 60, interval: "daily", durationDays: 5 },
      0
    );
    // Initial balance 100 covers one $60 buy, not two.
    const result = runSimulation(dca, dailyPoints([100, 100, 100]), 100, NO_FEES);

    expect(result.tradeCount).toBe(1);
    expect(result.finalQuoteBalance).toBeCloseTo(40, 10);
  });

  it("scores a profitable grid round trip as a win", () => {
    const grid = gridStrategy.create(
      { pair: "BTCUSDT", lowerBound: 100, upperBound: 200, gridLevels: 6, amountPerLevel: 100 },
      0
    );
    // 150 (ref) → 135 buys the 140 level → 165 sells it at a profit.
    const result = runSimulation(grid, dailyPoints([150, 135, 165]), 1000, NO_FEES);

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
    const result = runSimulation(dca, dailyPoints(prices), 1000, NO_FEES);

    expect(result.equityCurve.length).toBeLessThanOrEqual(501);
    expect(result.equityCurve[result.equityCurve.length - 1].timestamp).toBe(1999 * DAY_MS);
  });
});

describe("runSimulation (fees & slippage)", () => {
  it("charges 0.1% on a buy, hand-checked", () => {
    // One DCA buy of $100 at price 100 with 0.1% fee:
    // cash: 1000 − 100 − 0.10 = 899.90; coins: exactly 1.0 (fee taken in quote).
    const dca = dcaStrategy.create(
      { pair: "BTCUSDT", amountPerBuy: 100, interval: "daily", durationDays: 0 },
      0
    );
    const result = runSimulation(dca, dailyPoints([100]), 1000, BINANCE_FEES);

    expect(result.tradeCount).toBe(1);
    expect(result.finalBaseBalance).toBeCloseTo(1.0, 12);
    expect(result.finalQuoteBalance).toBeCloseTo(899.9, 10);
    expect(result.feesPaid).toBeCloseTo(0.1, 12);
    // Equity: 899.90 + 1 × 100 = 999.90 → P&L is exactly the fee.
    expect(result.pnl).toBeCloseTo(-0.1, 10);
  });

  it("charges the fee on sell proceeds, hand-checked on a grid round trip", () => {
    const grid = gridStrategy.create(
      { pair: "BTCUSDT", lowerBound: 100, upperBound: 200, gridLevels: 6, amountPerLevel: 100 },
      0
    );
    // Buy $100 at 135 (fee $0.10), sell 100/135 coins at 165:
    // gross = 165 × 100/135 = 122.2222…, sell fee = 0.1222…
    const result = runSimulation(grid, dailyPoints([150, 135, 165]), 1000, BINANCE_FEES);

    const gross = (100 / 135) * 165;
    expect(result.feesPaid).toBeCloseTo(0.1 + gross * 0.001, 10);
    expect(result.pnl).toBeCloseTo(gross - 100 - 0.1 - gross * 0.001, 8);
    expect(result.winRate).toBe(1); // still a clear win after fees
  });

  it("a buy is skipped when the balance covers the amount but not the fee", () => {
    const dca = dcaStrategy.create(
      { pair: "BTCUSDT", amountPerBuy: 100, interval: "daily", durationDays: 5 },
      0
    );
    // $100.05 covers the $100 buy but not the $0.10 fee.
    const result = runSimulation(dca, dailyPoints([100, 100]), 100.05, BINANCE_FEES);
    expect(result.tradeCount).toBe(0);
  });

  it("grid spacing below 2× fee loses money on every round trip", () => {
    // Range 100–101 with 11 levels → 0.1 spacing ≈ 0.1% per step,
    // while a round trip costs ~0.2% in fees. Every trip must lose.
    const grid = gridStrategy.create(
      { pair: "BTCUSDT", lowerBound: 100, upperBound: 101, gridLevels: 11, amountPerLevel: 100 },
      0
    );
    // Oscillate across one level several times: buy at 100.45, sell at 100.60.
    const prices = [100.55, 100.45, 100.62, 100.45, 100.62, 100.45, 100.62];
    const result = runSimulation(grid, dailyPoints(prices), 1000, BINANCE_FEES);

    const sells = result.trades.filter((t) => t.side === "sell");
    expect(sells.length).toBeGreaterThanOrEqual(3);
    expect(result.winRate).toBe(0); // every round trip lost after fees
    expect(result.pnl).toBeLessThan(0);
  });

  it("applies slippage against the trader on both sides", () => {
    // 100 bps = 1% slippage. Buy at observed 100 → executes at 101.
    const dca = dcaStrategy.create(
      { pair: "BTCUSDT", amountPerBuy: 101, interval: "daily", durationDays: 0 },
      0
    );
    const result = runSimulation(dca, dailyPoints([100]), 1000, {
      feeRate: 0,
      slippageBps: 100,
    });

    expect(result.trades[0].price).toBeCloseTo(101, 10);
    expect(result.finalBaseBalance).toBeCloseTo(1.0, 12);
  });
});
