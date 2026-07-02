import { z } from "zod";
import type {
  PortfolioState,
  PricePoint,
  StrategyDefinition,
  StrategyInstance,
  TradeDecision,
} from "./types";

export const dcaParamsSchema = z.object({
  pair: z.string().min(1),
  /** Quote currency spent on every buy, e.g. 50 (USDT). */
  amountPerBuy: z.number().positive(),
  interval: z.enum(["daily", "weekly"]),
  /** How long the strategy keeps buying, counted from its start. */
  durationDays: z.number().int().positive(),
});

export type DcaParams = z.infer<typeof dcaParamsSchema>;

const DAY_MS = 24 * 60 * 60 * 1000;

interface DcaState {
  /** ms epoch of the next scheduled buy. */
  nextBuyTime: number;
  /** ms epoch after which no more buys happen. */
  endTime: number;
}

/**
 * Dollar-Cost Averaging: buy a fixed quote amount on a fixed schedule,
 * regardless of price. Never sells — it only accumulates.
 *
 * The first buy happens at the strategy's start, then every interval after
 * that until the configured duration has elapsed.
 */
class DcaInstance implements StrategyInstance {
  private state: DcaState;
  private readonly intervalMs: number;

  constructor(
    private readonly params: DcaParams,
    startTimeMs: number
  ) {
    this.intervalMs = (params.interval === "daily" ? 1 : 7) * DAY_MS;
    this.state = {
      nextBuyTime: startTimeMs,
      endTime: startTimeMs + params.durationDays * DAY_MS,
    };
  }

  onPrice(point: PricePoint, _portfolio: PortfolioState): TradeDecision[] {
    const decisions: TradeDecision[] = [];

    // A while-loop (not an if) so that a gap in price data larger than the
    // interval still triggers the buys that fell inside the gap, instead of
    // silently dropping them.
    while (
      point.timestamp >= this.state.nextBuyTime &&
      this.state.nextBuyTime <= this.state.endTime
    ) {
      decisions.push({ side: "buy", quoteAmount: this.params.amountPerBuy });
      this.state.nextBuyTime += this.intervalMs;
    }

    return decisions;
  }

  getState(): DcaState {
    return { ...this.state };
  }

  setState(state: unknown): void {
    this.state = state as DcaState;
  }
}

export const dcaStrategy: StrategyDefinition<DcaParams> = {
  slug: "dca",
  paramsSchema: dcaParamsSchema,
  create: (params, startTimeMs) => new DcaInstance(params, startTimeMs),
};
