import type { z } from "zod";

/** A single observed price, from a historical candle (backtest) or a live tick (paper trading). */
export interface PricePoint {
  price: number;
  /** ms epoch */
  timestamp: number;
}

/** What the strategy is allowed to know about the simulated account. */
export interface PortfolioState {
  /** Simulated cash, in the quote currency (e.g. USDT). */
  quoteBalance: number;
  /** Simulated coins held, in the base currency (e.g. BTC). */
  baseBalance: number;
}

/**
 * A buy is expressed in quote currency ("spend $50") because that's how both
 * strategies think about buying; a sell is expressed in base quantity
 * ("sell 0.0008 BTC") because you sell coins you already hold.
 * The executor converts one to the other using the execution price.
 */
export type TradeDecision =
  | { side: "buy"; quoteAmount: number }
  | { side: "sell"; quantity: number };

/**
 * A live strategy with internal state (e.g. "when is my next DCA buy",
 * "which grid levels am I holding"). Deliberately pure: no DB, no HTTP,
 * no clock — the caller supplies time and prices. That is what makes the
 * same implementation usable for backtesting AND paper trading, and makes
 * backtests deterministic.
 */
export interface StrategyInstance {
  /** Called once per price point, in chronological order. */
  onPrice(point: PricePoint, portfolio: PortfolioState): TradeDecision[];
  /** Serializable snapshot, persisted so paper sessions survive server restarts. */
  getState(): unknown;
  /** Restore a snapshot produced by getState(). */
  setState(state: unknown): void;
}

export interface StrategyDefinition<P = unknown> {
  /** Matches the `slug` column in the strategies table. */
  slug: string;
  /** Validates user-supplied params before they ever reach the engine or the DB. */
  paramsSchema: z.ZodType<P>;
  /**
   * @param startTimeMs when the strategy's clock starts: the first candle of
   * a backtest, or the moment a paper session is created.
   */
  create(params: P, startTimeMs: number): StrategyInstance;
}
