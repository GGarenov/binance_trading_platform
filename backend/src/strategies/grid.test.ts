import { describe, expect, it } from "vitest";
import { gridStrategy } from "./grid";
import type { PortfolioState, PricePoint, TradeDecision } from "./types";

const portfolio: PortfolioState = { quoteBalance: 10_000, baseBalance: 0 };

// Levels for these params: [100, 120, 140, 160, 180, 200] — 5 buy slots.
const params = {
  pair: "BTCUSDT",
  lowerBound: 100,
  upperBound: 200,
  gridLevels: 6,
  amountPerLevel: 100,
};

let t = 0;
function feed(instance: ReturnType<typeof gridStrategy.create>, price: number): TradeDecision[] {
  const point: PricePoint = { price, timestamp: ++t };
  return instance.onPrice(point, portfolio);
}

describe("Grid strategy", () => {
  it("does nothing on the first tick (needs a reference price)", () => {
    const grid = gridStrategy.create(params, 0);
    expect(feed(grid, 150)).toEqual([]);
  });

  it("buys when the price crosses down through a level, sells one level higher", () => {
    const grid = gridStrategy.create(params, 0);

    feed(grid, 150); // reference
    const buys = feed(grid, 135); // crossed down through 140
    expect(buys).toEqual([{ side: "buy", quoteAmount: 100 }]);

    expect(feed(grid, 150)).toEqual([]); // 160 not reached yet — still holding

    const sells = feed(grid, 165); // reached 160, the level above the 140 buy
    expect(sells).toHaveLength(1);
    expect(sells[0].side).toBe("sell");
    // Sells exactly the quantity the buy acquired: 100 USDT / 135.
    expect(sells[0]).toMatchObject({ quantity: 100 / 135 });
  });

  it("a big drop through several levels buys each of them", () => {
    const grid = gridStrategy.create(params, 0);

    feed(grid, 190); // reference
    const buys = feed(grid, 105); // crossed 180, 160, 140, 120 — four buy levels
    expect(buys.filter((d) => d.side === "buy")).toHaveLength(4);
  });

  it("does not re-buy a level while the price stays below it", () => {
    const grid = gridStrategy.create(params, 0);

    feed(grid, 150);
    expect(feed(grid, 135)).toHaveLength(1); // crossing: buy
    expect(feed(grid, 130)).toEqual([]); // still below 140: no second buy
    expect(feed(grid, 138)).toEqual([]);
  });

  it("does nothing outside the configured range", () => {
    const grid = gridStrategy.create(params, 0);

    feed(grid, 250); // reference, above range
    expect(feed(grid, 220)).toEqual([]); // moves above the range: no levels crossed
    expect(feed(grid, 95)).toHaveLength(5); // crashing through the whole grid buys all 5 slots
    expect(feed(grid, 90)).toEqual([]); // below range: nothing further
  });

  it("completes repeated round trips as the price oscillates", () => {
    const grid = gridStrategy.create(params, 0);

    feed(grid, 150);
    let buys = 0;
    let sells = 0;
    // Price ping-pongs between the 140 level and its 160 sell target.
    // (Touching exactly 160 sells but does NOT count as crossing above it,
    // so the subsequent drop only re-buys the 140 level, not 160.)
    for (const price of [135, 160, 139, 160, 138, 160]) {
      for (const d of feed(grid, price)) {
        if (d.side === "buy") buys++;
        else sells++;
      }
    }
    expect(buys).toBe(3);
    expect(sells).toBe(3);
  });

  it("resumes from a state snapshot with holdings intact", () => {
    const grid = gridStrategy.create(params, 0);
    feed(grid, 150);
    feed(grid, 135); // holding the 140 level
    const snapshot = grid.getState();

    const resumed = gridStrategy.create(params, 0);
    resumed.setState(snapshot);

    // Held level must not re-buy...
    expect(feed(resumed, 134)).toEqual([]);
    // ...and its sell target still works after the restart.
    const sells = feed(resumed, 161);
    expect(sells).toHaveLength(1);
    expect(sells[0].side).toBe("sell");
  });
});
