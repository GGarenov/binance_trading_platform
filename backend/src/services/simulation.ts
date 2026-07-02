import type { PricePoint, StrategyInstance } from "../strategies/types";

export interface SimulatedFill {
  side: "buy" | "sell";
  price: number;
  quantity: number;
  quoteAmount: number;
  /** ms epoch of the price point that triggered the fill. */
  executedAt: number;
}

export interface EquitySample {
  timestamp: number;
  equity: number;
}

export interface SimulationResult {
  initialBalance: number;
  finalQuoteBalance: number;
  finalBaseBalance: number;
  /** Total account value at the last price: cash + coins × final price. */
  finalEquity: number;
  pnl: number;
  pnlPct: number;
  /**
   * Share of sells that closed above their (FIFO-matched) buy price.
   * null when the strategy never sold — win rate is meaningless for pure
   * accumulation strategies like DCA.
   */
  winRate: number | null;
  tradeCount: number;
  trades: SimulatedFill[];
  equityCurve: EquitySample[];
}

const MAX_EQUITY_SAMPLES = 500;

/**
 * The execution engine shared by backtesting (and mirrored by paper trading):
 * feeds prices to a strategy in order, turns its decisions into fills, and
 * tracks balances. Fills happen at the triggering price with no fees or
 * slippage — a documented MVP simplification.
 */
export function runSimulation(
  strategy: StrategyInstance,
  points: PricePoint[],
  initialBalance: number
): SimulationResult {
  let quoteBalance = initialBalance;
  let baseBalance = 0;

  const trades: SimulatedFill[] = [];
  const equityCurve: EquitySample[] = [];

  // FIFO queue of open buys, used only for win-rate accounting.
  const openBuys: { price: number; quantity: number }[] = [];
  let sells = 0;
  let winningSells = 0;

  for (const point of points) {
    const decisions = strategy.onPrice(point, { quoteBalance, baseBalance });

    for (const decision of decisions) {
      if (decision.side === "buy") {
        // Skip (don't crash) when the simulated account can't afford the buy —
        // same as a real bot with an empty wallet.
        if (decision.quoteAmount > quoteBalance) continue;
        const quantity = decision.quoteAmount / point.price;
        quoteBalance -= decision.quoteAmount;
        baseBalance += quantity;
        openBuys.push({ price: point.price, quantity });
        trades.push({
          side: "buy",
          price: point.price,
          quantity,
          quoteAmount: decision.quoteAmount,
          executedAt: point.timestamp,
        });
      } else {
        const quantity = Math.min(decision.quantity, baseBalance);
        if (quantity <= 0) continue;
        const quoteAmount = quantity * point.price;
        baseBalance -= quantity;
        quoteBalance += quoteAmount;
        trades.push({
          side: "sell",
          price: point.price,
          quantity,
          quoteAmount,
          executedAt: point.timestamp,
        });

        // Win-rate accounting: average cost of the FIFO-matched buys.
        let remaining = quantity;
        let cost = 0;
        while (remaining > 1e-12 && openBuys.length > 0) {
          const lot = openBuys[0];
          const used = Math.min(lot.quantity, remaining);
          cost += used * lot.price;
          lot.quantity -= used;
          remaining -= used;
          if (lot.quantity <= 1e-12) openBuys.shift();
        }
        sells++;
        if (quoteAmount > cost) winningSells++;
      }
    }

    equityCurve.push({
      timestamp: point.timestamp,
      equity: quoteBalance + baseBalance * point.price,
    });
  }

  const lastPrice = points.length > 0 ? points[points.length - 1].price : 0;
  const finalEquity = quoteBalance + baseBalance * lastPrice;

  return {
    initialBalance,
    finalQuoteBalance: quoteBalance,
    finalBaseBalance: baseBalance,
    finalEquity,
    pnl: finalEquity - initialBalance,
    pnlPct: initialBalance > 0 ? ((finalEquity - initialBalance) / initialBalance) * 100 : 0,
    winRate: sells > 0 ? winningSells / sells : null,
    tradeCount: trades.length,
    trades,
    equityCurve: downsample(equityCurve, MAX_EQUITY_SAMPLES),
  };
}

/**
 * Keeps the equity curve small enough to store in a JSONB column and send to
 * the frontend chart. Always keeps the final sample — the end value is the
 * number users care about most.
 */
function downsample(samples: EquitySample[], max: number): EquitySample[] {
  if (samples.length <= max) return samples;
  const step = Math.ceil(samples.length / max);
  const result = samples.filter((_, i) => i % step === 0);
  if (result[result.length - 1] !== samples[samples.length - 1]) {
    result.push(samples[samples.length - 1]);
  }
  return result;
}
