import { z } from "zod";
import type {
  PortfolioState,
  PricePoint,
  StrategyDefinition,
  StrategyInstance,
  TradeDecision,
} from "./types";

export const gridParamsSchema = z
  .object({
    pair: z.string().min(1),
    lowerBound: z.number().positive(),
    upperBound: z.number().positive(),
    /** Number of grid lines, including both bounds. 6 levels = 5 tradable slots. */
    gridLevels: z.number().int().min(2).max(200),
    /** Quote currency spent when a level's buy triggers, e.g. 100 (USDT). */
    amountPerLevel: z.number().positive(),
  })
  .refine((p) => p.upperBound > p.lowerBound, {
    message: "upperBound must be greater than lowerBound",
  });

export type GridParams = z.infer<typeof gridParamsSchema>;

interface GridState {
  /**
   * One slot per level except the topmost (you always sell one level above
   * where you bought, so the top level can't be a buy). null = not holding;
   * a number = base quantity bought at that level, waiting to be sold.
   */
  holdings: (number | null)[];
  /** Previous observed price, used to detect level crossings. null until the first tick. */
  lastPrice: number | null;
}

/**
 * Grid Trading: evenly spaced price levels between lowerBound and upperBound.
 * When the price crosses DOWN through a level we buy a fixed quote amount;
 * when it later rises to the level ABOVE that buy, we sell exactly what we
 * bought — locking in one grid step of profit per round trip.
 *
 * Outside the configured range the strategy does nothing (that is the main
 * documented risk of grid trading).
 */
class GridInstance implements StrategyInstance {
  private state: GridState;
  /** Grid line prices, ascending: levels[0] = lowerBound, levels[last] = upperBound. */
  private readonly levels: number[];

  constructor(private readonly params: GridParams) {
    const { lowerBound, upperBound, gridLevels } = params;
    const step = (upperBound - lowerBound) / (gridLevels - 1);
    this.levels = Array.from({ length: gridLevels }, (_, i) => lowerBound + i * step);
    this.state = {
      holdings: new Array(gridLevels - 1).fill(null),
      lastPrice: null,
    };
  }

  onPrice(point: PricePoint, _portfolio: PortfolioState): TradeDecision[] {
    const { price } = point;
    const decisions: TradeDecision[] = [];
    const { holdings, lastPrice } = this.state;

    // First tick only establishes the reference price: a "crossing" needs
    // a before and an after.
    if (lastPrice === null) {
      this.state.lastPrice = price;
      return decisions;
    }

    // Downward crossings → buy. Requiring lastPrice to be ABOVE the level
    // (not just price below it) means each level buys once per crossing,
    // not on every tick the price spends under it.
    for (let i = 0; i < holdings.length; i++) {
      const level = this.levels[i];
      if (holdings[i] === null && lastPrice > level && price <= level) {
        decisions.push({ side: "buy", quoteAmount: this.params.amountPerLevel });
        // Mirrors the executor's fill math (quantity = quote / price) so the
        // later sell releases exactly what the buy acquired.
        holdings[i] = this.params.amountPerLevel / price;
      }
    }

    // Sell targets → sell. No crossing requirement here: if we hold a level
    // and the price is at or above the level right ABOVE it, take the profit.
    for (let i = 0; i < holdings.length; i++) {
      const quantity = holdings[i];
      const sellTarget = this.levels[i + 1];
      if (quantity !== null && price >= sellTarget) {
        // costBasis: this sell closes exactly one level's buy, which spent
        // amountPerLevel — telling the executor avoids misleading FIFO matching.
        decisions.push({ side: "sell", quantity, costBasis: this.params.amountPerLevel });
        holdings[i] = null;
      }
    }

    this.state.lastPrice = price;
    return decisions;
  }

  getState(): GridState {
    return { holdings: [...this.state.holdings], lastPrice: this.state.lastPrice };
  }

  setState(state: unknown): void {
    this.state = state as GridState;
  }
}

export const gridStrategy: StrategyDefinition<GridParams> = {
  slug: "grid",
  paramsSchema: gridParamsSchema,
  create: (params) => new GridInstance(params),
};
