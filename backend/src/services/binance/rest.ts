import { Spot } from "@binance/spot";

// Public market data needs no API key. The connector's config type requires
// the field, but an empty string is fine — it's only sent for signed endpoints,
// none of which we call in the MVP.
const client = new Spot({ configurationRestAPI: { apiKey: "", apiSecret: "" } });

export interface Candle {
  openTime: number; // ms epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number; // ms epoch
}

export interface SymbolInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
}

const MAX_KLINES_PER_REQUEST = 1000;

/**
 * Fetch candles for [startTime, endTime]. Binance caps each request at 1000
 * candles, so this pages through the range using the last candle's close time
 * as the cursor for the next request.
 */
export async function fetchKlines(
  symbol: string,
  interval: string,
  startTime: number,
  endTime: number
): Promise<Candle[]> {
  const candles: Candle[] = [];
  let cursor = startTime;

  while (cursor < endTime) {
    const response = await client.restAPI.klines({
      symbol,
      // The connector types intervals as an enum; the wire format is the
      // plain string ('1h', '1d', ...), so the cast is safe.
      interval: interval as Parameters<typeof client.restAPI.klines>[0]["interval"],
      startTime: cursor,
      endTime,
      limit: MAX_KLINES_PER_REQUEST,
    });
    const rows = (await response.data()) as unknown as (string | number)[][];

    if (rows.length === 0) break;

    for (const row of rows) {
      candles.push({
        openTime: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
        closeTime: Number(row[6]),
      });
    }

    const lastCloseTime = Number(rows[rows.length - 1][6]);
    // Next page starts just after the last candle we received.
    cursor = lastCloseTime + 1;

    if (rows.length < MAX_KLINES_PER_REQUEST) break;
  }

  return candles;
}

/** Trading pairs currently active on Binance spot, e.g. for the config form dropdown. */
export async function fetchSymbols(quoteAsset = "USDT"): Promise<SymbolInfo[]> {
  const response = await client.restAPI.exchangeInfo({});
  const data = (await response.data()) as {
    symbols?: {
      symbol?: string;
      baseAsset?: string;
      quoteAsset?: string;
      status?: string;
    }[];
  };

  return (data.symbols ?? [])
    .filter((s) => s.status === "TRADING" && s.quoteAsset === quoteAsset)
    .map((s) => ({
      symbol: s.symbol ?? "",
      baseAsset: s.baseAsset ?? "",
      quoteAsset: s.quoteAsset ?? "",
    }));
}
