import { describe, expect, it } from "vitest";
import { buildEquityCurveFromKlines } from "./reportShared";
import type { SimulatedFill } from "./simulation";

const HOUR_MS = 60 * 60_000;

function fill(side: "buy" | "sell", price: number, qty: number, hour: number): SimulatedFill {
  return {
    side,
    price,
    quantity: qty,
    quoteAmount: price * qty,
    fee: 0,
    executedAt: hour * HOUR_MS,
  };
}

describe("buildEquityCurveFromKlines", () => {
  it("tracks equity across hourly candles with a buy", () => {
    const candles = [
      { closeTime: 0, close: 100 },
      { closeTime: HOUR_MS, close: 110 },
      { closeTime: 2 * HOUR_MS, close: 120 },
    ];
    const fills = [fill("buy", 100, 1, 0)];
    const curve = buildEquityCurveFromKlines(1000, fills, candles);

    expect(curve[0].equity).toBeCloseTo(1000, 6);
    expect(curve[1].equity).toBeCloseTo(900 + 110, 6);
    expect(curve[2].equity).toBeCloseTo(900 + 120, 6);
  });
});
