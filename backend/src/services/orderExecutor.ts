import type { PricePoint, TradeDecision } from "../strategies/types";
import type { Balances, SimulatedFill } from "./simulation";
import { fetchSymbolFilters, placeMarketOrder } from "./binance/testnet";

/**
 * A real (testnet) fill. Same shape as a simulated fill so the session
 * bookkeeping code doesn't care which executor produced it, plus the price
 * the strategy intended — the gap between the two is real slippage.
 */
export interface LiveFill extends SimulatedFill {
  intendedPrice: number;
  orderId: number;
}

/**
 * Rounds a base-asset quantity DOWN to the symbol's LOT_SIZE step.
 * Down, never to nearest: rounding up could sell coins we don't own.
 * Works on integer step counts to dodge floating-point dust
 * (e.g. 0.070000000000000007 for a 0.00001 step).
 */
export function roundDownToStep(quantity: number, stepSize: number): number {
  if (stepSize <= 0) return quantity;
  const steps = Math.floor(quantity / stepSize + 1e-9);
  return Number((steps * stepSize).toFixed(12));
}

/**
 * Executes one strategy decision as a real MARKET order on the Binance
 * testnet, then applies the ACTUAL fill (executed price, quantity, exchange
 * commission) to the session balances. Mirrors executeFill in simulation.ts,
 * with the exchange replacing the fee/slippage model.
 *
 * Returns null when the order can't be placed legally (below minNotional /
 * minQty, insufficient session balance) — skip, don't crash, same policy as
 * the simulator.
 */
export async function executeTestnetFill(
  decision: TradeDecision,
  pair: string,
  point: PricePoint,
  balances: Balances
): Promise<LiveFill | null> {
  const filters = await fetchSymbolFilters(pair);

  if (decision.side === "buy") {
    if (decision.quoteAmount > balances.quoteBalance) return null;
    if (decision.quoteAmount < filters.minNotional) return null;

    const order = await placeMarketOrder(pair, "buy", { quoteOrderQty: decision.quoteAmount });
    // Buy commissions are taken from the received coins, so the session
    // keeps what actually landed in the wallet.
    const receivedQty = order.executedQty - order.baseCommission;
    balances.quoteBalance -= order.cummulativeQuoteQty;
    balances.baseBalance += receivedQty;

    return {
      side: "buy",
      price: order.avgPrice,
      quantity: receivedQty,
      quoteAmount: order.cummulativeQuoteQty,
      fee: order.feeInQuote,
      executedAt: order.transactTime,
      intendedPrice: point.price,
      orderId: order.orderId,
    };
  }

  const desired = Math.min(decision.quantity, balances.baseBalance);
  const quantity = roundDownToStep(desired, filters.stepSize);
  if (quantity <= 0 || quantity < filters.minQty) return null;
  // Market sells have no quoted price; estimate notional with the tick price.
  if (quantity * point.price < filters.minNotional) return null;

  const order = await placeMarketOrder(pair, "sell", { quantity });
  const proceeds = order.cummulativeQuoteQty - order.quoteCommission;
  balances.baseBalance -= order.executedQty;
  balances.quoteBalance += proceeds;

  return {
    side: "sell",
    price: order.avgPrice,
    quantity: order.executedQty,
    quoteAmount: order.cummulativeQuoteQty,
    fee: order.feeInQuote,
    executedAt: order.transactTime,
    intendedPrice: point.price,
    orderId: order.orderId,
  };
}
