import { z } from "zod";
import { sma } from "./indicators";
import type {
  PortfolioState,
  PricePoint,
  StrategyDefinition,
  StrategyInstance,
  TradeDecision,
} from "./types";

export const maCrossoverParamsSchema = z
  .object({
    pair: z.string().min(1),
    /** Fast average, reacts quickly (in hourly samples). */
    shortPeriod: z.number().int().min(2).max(200),
    /** Slow average, the underlying trend (in hourly samples). */
    longPeriod: z.number().int().min(3).max(500),
    /** Quote currency spent when a buy signal fires. */
    amountPerEntry: z.number().positive(),
  })
  .refine((p) => p.longPeriod > p.shortPeriod, {
    message: "longPeriod must be greater than shortPeriod",
  });

export type MaCrossoverParams = z.infer<typeof maCrossoverParamsSchema>;

/**
 * Indicator strategies sample the price once per hour (using whatever price
 * point arrives at/after the hour mark). This makes backtests (1h candles)
 * and paper trading (1-second ticks) see the same effective series, so the
 * configured periods always mean "hours".
 */
const SAMPLE_MS = 60 * 60 * 1000;

interface MaState {
  /** Hourly closes, capped at longPeriod (all the SMAs ever need). */
  closes: number[];
  lastSampleTime: number | null;
  /** Base quantity currently held, null when out of the market. */
  holdingQty: number | null;
  /** Was the short SMA above the long SMA at the previous sample? */
  prevShortAboveLong: boolean | null;
}

/**
 * Moving Average Crossover (trend following): when the fast average rises
 * above the slow one, the trend is turning up — buy. When it falls back
 * below, the trend is turning down — sell everything. One position at a time.
 */
class MaCrossoverInstance implements StrategyInstance {
  private state: MaState = {
    closes: [],
    lastSampleTime: null,
    holdingQty: null,
    prevShortAboveLong: null,
  };

  constructor(private readonly params: MaCrossoverParams) {}

  onPrice(point: PricePoint, _portfolio: PortfolioState): TradeDecision[] {
    const s = this.state;
    if (s.lastSampleTime !== null && point.timestamp < s.lastSampleTime + SAMPLE_MS) {
      return [];
    }
    s.lastSampleTime = point.timestamp;

    s.closes.push(point.price);
    if (s.closes.length > this.params.longPeriod) {
      s.closes.splice(0, s.closes.length - this.params.longPeriod);
    }

    const shortSma = sma(s.closes, this.params.shortPeriod);
    const longSma = sma(s.closes, this.params.longPeriod);
    if (shortSma === null || longSma === null) return [];

    const above = shortSma > longSma;
    const decisions: TradeDecision[] = [];

    // Trade on the *change* of the relationship, not the relationship itself —
    // otherwise we'd buy on every sample of an uptrend.
    if (s.prevShortAboveLong !== null) {
      if (above && !s.prevShortAboveLong && s.holdingQty === null) {
        decisions.push({ side: "buy", quoteAmount: this.params.amountPerEntry });
        s.holdingQty = this.params.amountPerEntry / point.price;
      } else if (!above && s.prevShortAboveLong && s.holdingQty !== null) {
        decisions.push({
          side: "sell",
          quantity: s.holdingQty,
          costBasis: this.params.amountPerEntry,
        });
        s.holdingQty = null;
      }
    }

    s.prevShortAboveLong = above;
    return decisions;
  }

  getState(): MaState {
    return { ...this.state, closes: [...this.state.closes] };
  }

  setState(state: unknown): void {
    this.state = state as MaState;
  }
}

export const maCrossoverStrategy: StrategyDefinition<MaCrossoverParams> = {
  slug: "ma-crossover",
  paramsSchema: maCrossoverParamsSchema,
  // +1 so the crossover direction is already known at the first real sample.
  warmupCandles: (params) => params.longPeriod + 1,
  create: (params) => new MaCrossoverInstance(params),
};
