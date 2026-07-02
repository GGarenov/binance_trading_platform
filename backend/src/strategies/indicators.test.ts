import { describe, expect, it } from "vitest";
import { rsiFromCloses, sma } from "./indicators";

describe("sma", () => {
  it("returns null until enough values exist", () => {
    expect(sma([1, 2], 3)).toBeNull();
  });

  it("averages the last `period` values, hand-checked", () => {
    expect(sma([1, 2, 3, 4], 2)).toBe(3.5); // (3+4)/2
    expect(sma([10, 20, 30], 3)).toBe(20);
  });
});

describe("rsiFromCloses", () => {
  it("returns null until period+1 closes exist", () => {
    expect(rsiFromCloses([1, 2, 3], 3)).toBeNull();
  });

  it("is 100 when the price only ever rises", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(rsiFromCloses(closes, 14)).toBe(100);
  });

  it("is 0 when the price only ever falls", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i);
    expect(rsiFromCloses(closes, 14)).toBeCloseTo(0, 10);
  });

  it("hovers near 50 when gains and losses alternate equally", () => {
    // +1, −1, +1, −1… → gains ≈ losses. Wilder smoothing makes the value
    // oscillate slightly around 50 depending on the direction of the last
    // move, so assert a band rather than exact equality.
    const closes: number[] = [100];
    for (let i = 0; i < 30; i++) closes.push(closes[closes.length - 1] + (i % 2 === 0 ? 1 : -1));
    const rsi = rsiFromCloses(closes, 14)!;
    expect(rsi).toBeGreaterThan(45);
    expect(rsi).toBeLessThan(55);
  });

  it("hand-checked seed value on a small series", () => {
    // period 3, closes: 100 → 102 (+2), → 101 (−1), → 104 (+3)
    // avgGain = (2+0+3)/3 = 5/3, avgLoss = 1/3 → RS = 5 → RSI = 100 − 100/6 = 83.33…
    expect(rsiFromCloses([100, 102, 101, 104], 3)).toBeCloseTo(100 - 100 / 6, 10);
  });
});
