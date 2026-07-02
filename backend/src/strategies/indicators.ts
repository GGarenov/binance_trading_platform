/**
 * Pure indicator math, shared by strategies and unit tests.
 * Returns null while there isn't enough data yet — callers treat that as
 * "indicator not ready, do nothing".
 */

/** Simple moving average of the LAST `period` values. */
export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

/**
 * Wilder's RSI (0–100) over a series of closes: seeded with the simple
 * average of the first `period` price changes, then exponentially smoothed
 * over the rest of the series.
 *
 * Intuition: RSI compares recent gains to recent losses. Near 100 = everything
 * has been going up (possibly "overbought"), near 0 = everything down
 * (possibly "oversold"), 50 = balanced.
 */
export function rsiFromCloses(closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? -change : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}
