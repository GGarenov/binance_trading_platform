import { describe, expect, it } from "vitest";
import { dcaStrategy } from "./dca";
import type { PortfolioState, PricePoint } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000; // arbitrary fixed epoch so tests are deterministic

const portfolio: PortfolioState = { quoteBalance: 10_000, baseBalance: 0 };

function point(dayOffset: number, price: number): PricePoint {
  return { timestamp: T0 + dayOffset * DAY_MS, price };
}

describe("DCA strategy", () => {
  it("buys immediately at start, then once per interval, until duration ends", () => {
    const dca = dcaStrategy.create(
      { pair: "BTCUSDT", amountPerBuy: 50, interval: "daily", durationDays: 3 },
      T0
    );

    const buysPerDay = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].map(
      (day) => dca.onPrice(point(day, 100), portfolio).length
    );

    // Buys at day 0, 1, 2, 3 (duration inclusive); half-day ticks and day 4 do nothing.
    expect(buysPerDay).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 0]);
  });

  it("always spends the configured quote amount regardless of price", () => {
    const dca = dcaStrategy.create(
      { pair: "BTCUSDT", amountPerBuy: 75, interval: "daily", durationDays: 2 },
      T0
    );

    const prices = [100, 500, 20];
    for (const [i, price] of prices.entries()) {
      const decisions = dca.onPrice(point(i, price), portfolio);
      expect(decisions).toEqual([{ side: "buy", quoteAmount: 75 }]);
    }
  });

  it("catches up on buys that fall inside a gap in price data", () => {
    const dca = dcaStrategy.create(
      { pair: "BTCUSDT", amountPerBuy: 50, interval: "daily", durationDays: 10 },
      T0
    );

    expect(dca.onPrice(point(0, 100), portfolio)).toHaveLength(1);
    // Next data point arrives 3 days later: the day-1, day-2 and day-3 buys
    // all trigger at once instead of being dropped.
    expect(dca.onPrice(point(3, 100), portfolio)).toHaveLength(3);
  });

  it("weekly interval buys 5 times over 28 days", () => {
    const dca = dcaStrategy.create(
      { pair: "BTCUSDT", amountPerBuy: 50, interval: "weekly", durationDays: 28 },
      T0
    );

    let buys = 0;
    for (let day = 0; day <= 30; day++) {
      buys += dca.onPrice(point(day, 100), portfolio).length;
    }
    expect(buys).toBe(5); // days 0, 7, 14, 21, 28
  });

  it("resumes from a state snapshot without double-buying", () => {
    const dca = dcaStrategy.create(
      { pair: "BTCUSDT", amountPerBuy: 50, interval: "daily", durationDays: 10 },
      T0
    );
    dca.onPrice(point(0, 100), portfolio); // day-0 buy happened
    const snapshot = dca.getState();

    // Simulate a server restart: fresh instance, restored state.
    const resumed = dcaStrategy.create(
      { pair: "BTCUSDT", amountPerBuy: 50, interval: "daily", durationDays: 10 },
      T0
    );
    resumed.setState(snapshot);

    // Re-seeing the day-0 price must not re-buy; day 1 buys as scheduled.
    expect(resumed.onPrice(point(0.5, 100), portfolio)).toHaveLength(0);
    expect(resumed.onPrice(point(1, 100), portfolio)).toHaveLength(1);
  });
});
