import type { PricePoint, StrategyInstance, TradeDecision } from "../strategies/types";

/** Binance spot standard taker fee: 0.10% per side. */
export const DEFAULT_FEE_RATE = 0.001;

export interface ExecutionOptions {
  /** Fraction of trade value charged per fill, e.g. 0.001 = 0.10%. */
  feeRate: number;
  /**
   * Slippage in basis points, always applied AGAINST the trader: buys fill
   * slightly above the observed price, sells slightly below. 0 = fill at the
   * observed price exactly.
   */
  slippageBps: number;
}

export interface SimulatedFill {
  side: "buy" | "sell";
  /** Actual execution price after slippage. */
  price: number;
  quantity: number;
  quoteAmount: number;
  /** Fee charged for this fill, in quote currency. */
  fee: number;
  /** ms epoch of the price point that triggered the fill. */
  executedAt: number;
}

export interface Balances {
  quoteBalance: number;
  baseBalance: number;
}

/**
 * Turns one strategy decision into a fill, mutating the balances.
 * Returns null when the account can't afford the trade (skip, don't crash —
 * same as a real bot with an empty wallet).
 *
 * Fee model: fees are charged in QUOTE currency on both sides (deducted from
 * cash on buys, from proceeds on sells). Binance actually deducts buy fees
 * from the received coins, but charging in quote keeps the strategies'
 * quantity bookkeeping exact while being economically equivalent.
 *
 * Shared by backtesting and paper trading so their fill math can never drift apart.
 */
export function executeFill(
  decision: TradeDecision,
  point: PricePoint,
  balances: Balances,
  options: ExecutionOptions
): SimulatedFill | null {
  const slip = options.slippageBps / 10_000;

  if (decision.side === "buy") {
    const execPrice = point.price * (1 + slip);
    const fee = decision.quoteAmount * options.feeRate;
    // The buy only happens if the account covers the amount AND its fee.
    if (decision.quoteAmount + fee > balances.quoteBalance) return null;

    const quantity = decision.quoteAmount / execPrice;
    balances.quoteBalance -= decision.quoteAmount + fee;
    balances.baseBalance += quantity;
    return {
      side: "buy",
      price: execPrice,
      quantity,
      quoteAmount: decision.quoteAmount,
      fee,
      executedAt: point.timestamp,
    };
  }

  const execPrice = point.price * (1 - slip);
  const quantity = Math.min(decision.quantity, balances.baseBalance);
  if (quantity <= 0) return null;

  const gross = quantity * execPrice;
  const fee = gross * options.feeRate;
  balances.baseBalance -= quantity;
  balances.quoteBalance += gross - fee;
  return {
    side: "sell",
    price: execPrice,
    quantity,
    quoteAmount: gross,
    fee,
    executedAt: point.timestamp,
  };
}

export interface EquitySample {
  timestamp: number;
  equity: number;
}

export interface SimulationResult {
  initialBalance: number;
  feeRate: number;
  slippageBps: number;
  finalQuoteBalance: number;
  finalBaseBalance: number;
  /** Total account value at the last price: cash + coins × final price. */
  finalEquity: number;
  pnl: number;
  pnlPct: number;
  /** Total fees paid across all fills, in quote currency. */
  feesPaid: number;
  /**
   * Share of sells whose NET proceeds (after fees) beat their total cost
   * (buy amount + buy fee). null when the strategy never sold — win rate is
   * meaningless for pure accumulation strategies like DCA.
   */
  winRate: number | null;
  tradeCount: number;
  trades: SimulatedFill[];
  equityCurve: EquitySample[];
}

const MAX_EQUITY_SAMPLES = 500;

/**
 * The backtest execution loop: feeds prices to a strategy in order, executes
 * its decisions via executeFill, and tracks balances + statistics.
 */
export function runSimulation(
  strategy: StrategyInstance,
  points: PricePoint[],
  initialBalance: number,
  options: ExecutionOptions = { feeRate: DEFAULT_FEE_RATE, slippageBps: 0 }
): SimulationResult {
  const balances: Balances = { quoteBalance: initialBalance, baseBalance: 0 };

  const trades: SimulatedFill[] = [];
  const equityCurve: EquitySample[] = [];
  let feesPaid = 0;

  // FIFO queue of open buys, used for win-rate accounting when the strategy
  // doesn't state its own cost basis.
  const openBuys: { price: number; quantity: number }[] = [];
  let sells = 0;
  let winningSells = 0;

  for (const point of points) {
    const decisions = strategy.onPrice(point, { ...balances });

    for (const decision of decisions) {
      const fill = executeFill(decision, point, balances, options);
      if (!fill) continue;

      trades.push(fill);
      feesPaid += fill.fee;

      if (fill.side === "buy") {
        openBuys.push({ price: fill.price, quantity: fill.quantity });
      } else {
        // Win-rate accounting. Preferred: the strategy states exactly what
        // this quantity cost to buy (Grid does). Fallback: FIFO-match against
        // open buys. Either way the FIFO queue is consumed so later fallback
        // matches stay consistent.
        let remaining = fill.quantity;
        let fifoCost = 0;
        while (remaining > 1e-12 && openBuys.length > 0) {
          const lot = openBuys[0];
          const used = Math.min(lot.quantity, remaining);
          fifoCost += used * lot.price;
          lot.quantity -= used;
          remaining -= used;
          if (lot.quantity <= 1e-12) openBuys.shift();
        }
        const grossCost = decision.side === "sell" && decision.costBasis !== undefined
          ? decision.costBasis
          : fifoCost;
        // A win must clear the total cost including the fee paid to buy.
        const effectiveCost = grossCost * (1 + options.feeRate);
        const netProceeds = fill.quoteAmount - fill.fee;
        sells++;
        if (netProceeds > effectiveCost) winningSells++;
      }
    }

    equityCurve.push({
      timestamp: point.timestamp,
      equity: balances.quoteBalance + balances.baseBalance * point.price,
    });
  }

  const lastPrice = points.length > 0 ? points[points.length - 1].price : 0;
  const finalEquity = balances.quoteBalance + balances.baseBalance * lastPrice;

  return {
    initialBalance,
    feeRate: options.feeRate,
    slippageBps: options.slippageBps,
    finalQuoteBalance: balances.quoteBalance,
    finalBaseBalance: balances.baseBalance,
    finalEquity,
    pnl: finalEquity - initialBalance,
    pnlPct: initialBalance > 0 ? ((finalEquity - initialBalance) / initialBalance) * 100 : 0,
    feesPaid,
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
