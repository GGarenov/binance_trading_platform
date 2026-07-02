import { describe, expect, it } from "vitest";
import { roundDownToStep } from "./orderExecutor";

describe("roundDownToStep", () => {
  it("rounds down to the step, never up", () => {
    expect(roundDownToStep(0.123456, 0.0001)).toBe(0.1234);
    expect(roundDownToStep(0.1239999, 0.0001)).toBe(0.1239);
  });

  it("returns exact multiples unchanged (no float drift)", () => {
    expect(roundDownToStep(0.07, 0.00001)).toBe(0.07);
    expect(roundDownToStep(1.5, 0.5)).toBe(1.5);
  });

  it("returns 0 when the quantity is below one step", () => {
    expect(roundDownToStep(0.000004, 0.00001)).toBe(0);
  });

  it("passes quantity through when no step is defined", () => {
    expect(roundDownToStep(0.123456789, 0)).toBe(0.123456789);
  });
});
