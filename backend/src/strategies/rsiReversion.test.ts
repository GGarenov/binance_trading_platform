import { describe, expect, it } from "vitest";
import { rsiReversionStrategy } from "./rsiReversion";
import type { PortfolioState, TradeDecision } from "./types";

const HOUR_MS = 60 * 60 * 1000;
const portfolio: PortfolioState = { quoteBalance: 10_000, baseBalance: 0 };

const params = {
  pair: "BTCUSDT",
  rsiPeriod: 3,
  oversold: 30,
  overbought: 70,
  amountPerEntry: 500,
};

function run(
  instance: ReturnType<typeof rsiReversionStrategy.create>,
  prices: number[],
  startHour = 0
) {
  const decisions: TradeDecision[] = [];
  prices.forEach((price, i) => {
    decisions.push(...instance.onPrice({ price, timestamp: (startHour + i) * HOUR_MS }, portfolio));
  });
  return decisions;
}

describe("RSI Mean Reversion strategy", () => {
  it("makes no decisions before the RSI has enough data", () => {
    const rsi = rsiReversionStrategy.create(params, 0);
    expect(run(rsi, [100, 101, 102])).toEqual([]); // needs rsiPeriod+1 = 4 samples
  });

  it("buys when oversold, sells when overbought", () => {
    const rsi = rsiReversionStrategy.create(params, 0);
    // Steady fall → RSI 0 (oversold, buy); then steady rise → RSI 100 (overbought, sell).
    const decisions = run(rsi, [100, 98, 96, 94, 92, 95, 98, 101, 104]);

    expect(decisions.length).toBeGreaterThanOrEqual(2);
    expect(decisions[0].side).toBe("buy");
    expect(decisions[0]).toMatchObject({ quoteAmount: 500 });
    const sells = decisions.filter((d) => d.side === "sell");
    expect(sells).toHaveLength(1);
  });

  it("holds only one position at a time while oversold persists", () => {
    const rsi = rsiReversionStrategy.create(params, 0);
    // Keeps falling: RSI stays oversold for many samples → exactly one buy.
    const decisions = run(rsi, [100, 98, 96, 94, 92, 90, 88, 86, 84]);
    expect(decisions.filter((d) => d.side === "buy")).toHaveLength(1);
  });

  it("resumes from a snapshot with position and buffer intact", () => {
    const rsi = rsiReversionStrategy.create(params, 0);
    run(rsi, [100, 98, 96, 94, 92]); // bought on the way down
    const snapshot = rsi.getState();

    const resumed = rsiReversionStrategy.create(params, 0);
    resumed.setState(snapshot);
    // Still falling after restart: no duplicate buy.
    expect(run(resumed, [90], 10)).toEqual([]);
    // Recovery to overbought: the restored position gets sold.
    const decisions = run(resumed, [95, 100, 105, 110], 11);
    expect(decisions.filter((d) => d.side === "sell")).toHaveLength(1);
  });
});
