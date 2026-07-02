import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../lib/errors";
import { fetchKlines, fetchSymbols } from "../services/binance/rest";

export const marketRouter = Router();

// Granularities Binance supports and we allow through the API.
const INTERVALS = [
  "1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w",
] as const;

const klinesQuerySchema = z.object({
  symbol: z.string().min(1).transform((s) => s.toUpperCase()),
  interval: z.enum(INTERVALS).default("1h"),
  // z.coerce turns query-string values (always strings) into numbers.
  startTime: z.coerce.number().int().positive(),
  endTime: z.coerce.number().int().positive(),
});

marketRouter.get(
  "/klines",
  asyncHandler(async (req, res) => {
    const parsed = klinesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    const { symbol, interval, startTime, endTime } = parsed.data;
    if (startTime >= endTime) {
      throw new HttpError(400, "startTime must be before endTime");
    }

    const candles = await fetchKlines(symbol, interval, startTime, endTime);
    res.json({ symbol, interval, count: candles.length, candles });
  })
);

const symbolsQuerySchema = z.object({
  quote: z.enum(["USDT", "USDC"]).default("USDT"),
});

marketRouter.get(
  "/symbols",
  asyncHandler(async (req, res) => {
    const parsed = symbolsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(400, "quote must be USDT or USDC");
    }
    const symbols = await fetchSymbols(parsed.data.quote);
    res.json({ count: symbols.length, symbols });
  })
);
