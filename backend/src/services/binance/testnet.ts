import { Spot, SPOT_REST_API_TESTNET_URL } from "@binance/spot";
import { HttpError } from "../../lib/errors";

/**
 * Authenticated client for the Binance SPOT TESTNET — a separate exchange
 * with fake balances but real order matching. Everything here sends signed
 * requests, so testnet API keys are required (unlike the keyless public
 * client in rest.ts, which keeps pointing at production for market data).
 */

let client: Spot | null = null;

function getClient(): Spot {
  if (client) return client;

  const apiKey = process.env.BINANCE_TESTNET_API_KEY;
  const apiSecret = process.env.BINANCE_TESTNET_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new HttpError(
      400,
      "Binance testnet API keys are not configured. Set BINANCE_TESTNET_API_KEY and BINANCE_TESTNET_API_SECRET in backend/.env and restart the server."
    );
  }

  client = new Spot({
    configurationRestAPI: { apiKey, apiSecret, basePath: SPOT_REST_API_TESTNET_URL },
  });
  return client;
}

export function testnetKeysConfigured(): boolean {
  return Boolean(process.env.BINANCE_TESTNET_API_KEY && process.env.BINANCE_TESTNET_API_SECRET);
}

/** Free (spendable) balances per asset, e.g. { USDT: 10000, BTC: 1 }. */
export async function fetchTestnetBalances(): Promise<Record<string, number>> {
  const response = await getClient().restAPI.getAccount({ omitZeroBalances: true });
  const data = (await response.data()) as {
    balances?: { asset?: string; free?: string }[];
  };

  const balances: Record<string, number> = {};
  for (const b of data.balances ?? []) {
    if (b.asset) balances[b.asset] = Number(b.free ?? 0);
  }
  return balances;
}

export interface SymbolFilters {
  /** Base-asset quantity must be a multiple of this (LOT_SIZE.stepSize). */
  stepSize: number;
  /** Minimum base-asset quantity per order (LOT_SIZE.minQty). */
  minQty: number;
  /** Minimum order value in quote currency (NOTIONAL.minNotional). */
  minNotional: number;
  baseAsset: string;
  quoteAsset: string;
}

// Exchange filters change rarely; one fetch per symbol per process is plenty.
const filtersCache = new Map<string, SymbolFilters>();

/** Trading rules for a symbol ON THE TESTNET (its filters can differ from prod). */
export async function fetchSymbolFilters(symbol: string): Promise<SymbolFilters> {
  const cached = filtersCache.get(symbol);
  if (cached) return cached;

  const response = await getClient().restAPI.exchangeInfo({ symbol });
  const data = (await response.data()) as {
    symbols?: {
      symbol?: string;
      baseAsset?: string;
      quoteAsset?: string;
      filters?: {
        filterType?: string;
        stepSize?: string;
        minQty?: string;
        minNotional?: string;
      }[];
    }[];
  };

  const info = data.symbols?.find((s) => s.symbol === symbol);
  if (!info) throw new HttpError(400, `Symbol ${symbol} is not tradable on the Binance testnet`);

  const lotSize = info.filters?.find((f) => f.filterType === "LOT_SIZE");
  const notional = info.filters?.find(
    (f) => f.filterType === "NOTIONAL" || f.filterType === "MIN_NOTIONAL"
  );

  const filters: SymbolFilters = {
    stepSize: Number(lotSize?.stepSize ?? 0),
    minQty: Number(lotSize?.minQty ?? 0),
    minNotional: Number(notional?.minNotional ?? 0),
    baseAsset: info.baseAsset ?? "",
    quoteAsset: info.quoteAsset ?? "",
  };
  filtersCache.set(symbol, filters);
  return filters;
}

export interface LiveOrderResult {
  orderId: number;
  /** Base quantity actually filled. */
  executedQty: number;
  /** Quote value actually filled (sum over all partial fills). */
  cummulativeQuoteQty: number;
  /** Volume-weighted average fill price. */
  avgPrice: number;
  /** Commission converted to quote currency (testnet usually charges 0). */
  feeInQuote: number;
  /** Commission charged in the base asset (deducted from received coins on buys). */
  baseCommission: number;
  /** Commission charged in the quote asset (deducted from proceeds on sells). */
  quoteCommission: number;
  /** Exchange timestamp of the order. */
  transactTime: number;
}

/**
 * Places a MARKET order and returns the actual fill.
 * Buys spend an exact quote amount (quoteOrderQty) — Binance handles lot
 * rounding on its side. Sells must specify a base quantity, which the caller
 * is responsible for rounding to the symbol's stepSize first.
 */
export async function placeMarketOrder(
  symbol: string,
  side: "buy" | "sell",
  amount: { quoteOrderQty: number } | { quantity: number }
): Promise<LiveOrderResult> {
  const response = await getClient().restAPI.newOrder({
    symbol,
    side: side === "buy" ? "BUY" : "SELL",
    type: "MARKET",
    ...("quoteOrderQty" in amount
      ? { quoteOrderQty: amount.quoteOrderQty }
      : { quantity: amount.quantity }),
    newOrderRespType: "FULL",
  } as Parameters<ReturnType<typeof getClient>["restAPI"]["newOrder"]>[0]);

  const data = (await response.data()) as {
    orderId?: number;
    executedQty?: string;
    cummulativeQuoteQty?: string;
    transactTime?: number;
    fills?: { price?: string; qty?: string; commission?: string; commissionAsset?: string }[];
  };

  const executedQty = Number(data.executedQty ?? 0);
  const cummulativeQuoteQty = Number(data.cummulativeQuoteQty ?? 0);
  if (executedQty <= 0) {
    throw new Error(`Order ${data.orderId} for ${symbol} was accepted but nothing filled`);
  }
  const avgPrice = cummulativeQuoteQty / executedQty;

  const filters = await fetchSymbolFilters(symbol);
  let feeInQuote = 0;
  let baseCommission = 0;
  let quoteCommission = 0;
  for (const fill of data.fills ?? []) {
    const commission = Number(fill.commission ?? 0);
    if (commission === 0) continue;
    if (fill.commissionAsset === filters.quoteAsset) {
      quoteCommission += commission;
      feeInQuote += commission;
    } else if (fill.commissionAsset === filters.baseAsset) {
      baseCommission += commission;
      feeInQuote += commission * Number(fill.price ?? avgPrice);
    }
    // Commission in a third asset (BNB discounts) is ignored — it doesn't
    // touch the session's quote/base balances.
  }

  return {
    orderId: data.orderId ?? 0,
    executedQty,
    cummulativeQuoteQty,
    avgPrice,
    feeInQuote,
    baseCommission,
    quoteCommission,
    transactTime: data.transactTime ?? Date.now(),
  };
}
