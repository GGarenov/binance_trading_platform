import type { EquitySample, SimulatedFill } from "./simulation";
import type {
  BenchmarkComparison,
  MarketRegimeContext,
  PerformanceMetrics,
  ReportOpenPosition,
  ReportRoundTrip,
} from "./backtestAnalytics";
import { fillsToReportFills } from "./backtestAnalytics";

/** Bump when the export shape changes in a breaking way. */
export const REPORT_SCHEMA_VERSION = "1.0";

export type ReportType = "backtest" | "live_session";

export interface StrategyReport {
  schemaVersion: string;
  reportType: ReportType;
  generatedAt: string;
  runMetadata: {
    reportType: ReportType;
    backtestId?: number;
    sessionId?: number;
    sessionKind?: "paper" | "live_testnet";
    createdAt: string;
    status: string;
    strategy: {
      name: string;
      slug: string;
      version: string;
      riskLevel: string | null;
    };
    symbol: string;
    interval: string;
    period: {
      start: string;
      end: string;
      durationDays: number;
    };
    initialCapital: number;
    assumptions: {
      feeRate: number;
      feeRatePct: number;
      slippageBps: number;
      fillModel: string;
      quoteCurrency: string;
    };
  };
  strategyParameters: Record<string, unknown>;
  performance: PerformanceMetrics;
  benchmark: BenchmarkComparison;
  marketRegime: MarketRegimeContext;
  tradeLog: {
    roundTrips: ReportRoundTrip[];
    openPositions: ReportOpenPosition[];
    fills: ReturnType<typeof fillsToReportFills>;
  };
  equityCurve: EquitySample[];
  notes: string[];
}

export const MS_PER_DAY = 86_400_000;
const MAX_EQUITY_SAMPLES = 500;

/** Live sessions sample equity on 1h candles for drawdown/regime metrics. */
export const LIVE_SESSION_SAMPLE_INTERVAL = "1h";

export function dbTradeToFill(t: {
  side: string;
  price: { toString(): string };
  quantity: { toString(): string };
  quoteAmount: { toString(): string };
  fee: { toString(): string };
  executedAt: Date;
}): SimulatedFill {
  return {
    side: t.side as "buy" | "sell",
    price: Number(t.price),
    quantity: Number(t.quantity),
    quoteAmount: Number(t.quoteAmount),
    fee: Number(t.fee),
    executedAt: t.executedAt.getTime(),
  };
}

export function quoteFromPair(pair: string): string {
  if (pair.endsWith("USDC")) return "USDC";
  if (pair.endsWith("USDT")) return "USDT";
  return "QUOTE";
}

function downsample(samples: EquitySample[], max: number): EquitySample[] {
  if (samples.length <= max) return samples;
  const step = Math.ceil(samples.length / max);
  const result = samples.filter((_, i) => i % step === 0);
  if (result[result.length - 1] !== samples[samples.length - 1]) {
    result.push(samples[samples.length - 1]);
  }
  return result;
}

/**
 * Replays fills against hourly candles to build an equity curve for live sessions.
 */
export function buildEquityCurveFromKlines(
  initialBalance: number,
  fills: SimulatedFill[],
  candles: { closeTime: number; close: number }[]
): EquitySample[] {
  if (candles.length === 0) {
    const ts = fills.length > 0 ? fills[fills.length - 1].executedAt : Date.now();
    return [{ timestamp: ts, equity: initialBalance }];
  }

  let quote = initialBalance;
  let base = 0;
  let fillIdx = 0;
  const curve: EquitySample[] = [];

  for (const candle of candles) {
    while (fillIdx < fills.length && fills[fillIdx].executedAt <= candle.closeTime) {
      const f = fills[fillIdx++];
      if (f.side === "buy") {
        quote -= f.quoteAmount + f.fee;
        base += f.quantity;
      } else {
        base -= f.quantity;
        quote += f.quoteAmount - f.fee;
      }
    }
    curve.push({ timestamp: candle.closeTime, equity: quote + base * candle.close });
  }

  return downsample(curve, MAX_EQUITY_SAMPLES);
}
