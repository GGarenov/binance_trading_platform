import type { EquitySample, SimulatedFill } from "./simulation";

/** Standardized analytics block — same field names/units for every strategy. */
export interface PerformanceMetrics {
  /** Total return over the backtest period, percent (e.g. 5.25 = +5.25%). */
  totalReturnPct: number;
  /** Absolute profit/loss in quote currency. */
  totalPnl: number;
  /** Compound annual growth rate, percent. null when period < 1 day. */
  cagrPct: number | null;
  /** Peak-to-trough decline on the equity curve, percent (positive number). */
  maxDrawdownPct: number;
  /** Longest drawdown from peak to recovery, in days. */
  maxDrawdownDurationDays: number;
  /** Per-period Sharpe ratio, annualized. Risk-free rate assumed 0. */
  sharpeRatio: number | null;
  /** Per-period Sortino ratio, annualized. Risk-free rate assumed 0. */
  sortinoRatio: number | null;
  /** Share of profitable round trips, percent. null when no round trips. */
  winRatePct: number | null;
  /** Gross profit / gross loss on round trips. null when no losses. */
  profitFactor: number | null;
  /** Average net P&L of winning round trips, quote currency. */
  averageWin: number | null;
  /** Average net P&L of losing round trips (negative number). */
  averageLoss: number | null;
  /** |averageWin / averageLoss|. null when no losses. */
  winLossRatio: number | null;
  /** Total fill count (buys + sells). */
  fillCount: number;
  /** Completed buy→sell round trips. */
  roundTripCount: number;
  /** Mean round-trip holding time in days. null when no round trips. */
  averageTradeDurationDays: number | null;
  /** Largest net profit on a single round trip. null when no wins. */
  largestWin: number | null;
  /** Largest net loss on a single round trip (negative). null when no losses. */
  largestLoss: number | null;
}

export interface BenchmarkComparison {
  /** Buy-and-hold total return, percent. */
  buyAndHoldReturnPct: number;
  /** Buy-and-hold absolute P&L in quote currency. */
  buyAndHoldPnl: number;
  /** Buy-and-hold final equity after entry fee (hold to end, no exit fee). */
  buyAndHoldFinalEquity: number;
  /** Strategy total return minus buy-and-hold return, percent points. */
  excessReturnPct: number;
  /** Whether the strategy beat buy-and-hold on total return. */
  beatBuyAndHold: boolean;
  firstPrice: number;
  lastPrice: number;
}

export type MarketRegimeLabel =
  | "trending_up"
  | "trending_down"
  | "ranging"
  | "volatile";

export interface MarketRegimeContext {
  label: MarketRegimeLabel;
  /** Plain-language summary for AI/human readers. */
  summary: string;
  /** Buy-and-hold price return over the period, percent. */
  priceReturnPct: number;
  /** Annualized volatility of log returns, percent. */
  annualizedVolatilityPct: number;
  /** Linear-regression slope of log prices, per year (positive = uptrend). */
  trendSlopePerYear: number;
}

export interface ReportRoundTrip {
  roundTripIndex: number;
  entryTimestamp: string;
  exitTimestamp: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  grossPnl: number;
  netPnl: number;
  feesPaid: number;
  durationMs: number;
  durationDays: number;
  /** Only strategy-driven exits exist in this app — stops/TP not implemented. */
  exitReason: "signal";
}

export interface ReportOpenPosition {
  entryTimestamp: string;
  entryPrice: number;
  quantity: number;
  feesPaid: number;
  /** Mark-to-market P&L at the final candle close. */
  unrealizedPnl: number;
}

export interface ReportFill {
  fillIndex: number;
  side: "buy" | "sell";
  timestamp: string;
  price: number;
  quantity: number;
  quoteAmount: number;
  fee: number;
}

const INTERVAL_PERIODS_PER_YEAR: Record<string, number> = {
  "1m": 525_600,
  "5m": 105_120,
  "15m": 35_040,
  "30m": 17_520,
  "1h": 8_760,
  "4h": 2_190,
  "1d": 365,
};

const MS_PER_DAY = 86_400_000;

interface DrawdownStats {
  maxDrawdownPct: number;
  maxDrawdownDurationDays: number;
}

/**
 * FIFO-match sells to buys and compute per-round-trip P&L including fees.
 */
export function buildRoundTrips(
  fills: SimulatedFill[],
  feeRate: number,
  markPrice: number
): { roundTrips: ReportRoundTrip[]; openPositions: ReportOpenPosition[] } {
  const openLots: { price: number; quantity: number; fee: number; executedAt: number }[] = [];
  const roundTrips: ReportRoundTrip[] = [];
  let roundTripIndex = 0;

  for (const fill of fills) {
    if (fill.side === "buy") {
      openLots.push({
        price: fill.price,
        quantity: fill.quantity,
        fee: fill.fee,
        executedAt: fill.executedAt,
      });
      continue;
    }

    let remaining = fill.quantity;
    let costBasis = 0;
    let buyFees = 0;
    let weightedEntryTime = 0;
    let matchedQty = 0;

    while (remaining > 1e-12 && openLots.length > 0) {
      const lot = openLots[0];
      const used = Math.min(lot.quantity, remaining);
      costBasis += used * lot.price;
      buyFees += (used / lot.quantity) * lot.fee;
      weightedEntryTime += lot.executedAt * used;
      matchedQty += used;
      lot.quantity -= used;
      remaining -= used;
      if (lot.quantity <= 1e-12) openLots.shift();
    }

    if (matchedQty <= 0) continue;

    const entryPrice = costBasis / matchedQty;
    const entryTimestamp = weightedEntryTime / matchedQty;
    const grossProceeds = fill.quantity * fill.price;
    const netProceeds = grossProceeds - fill.fee;
    const totalCost = costBasis + buyFees;
    const netPnl = netProceeds - totalCost;
    const durationMs = fill.executedAt - entryTimestamp;

    roundTrips.push({
      roundTripIndex: roundTripIndex++,
      entryTimestamp: new Date(entryTimestamp).toISOString(),
      exitTimestamp: new Date(fill.executedAt).toISOString(),
      entryPrice,
      exitPrice: fill.price,
      quantity: matchedQty,
      grossPnl: grossProceeds - costBasis,
      netPnl,
      feesPaid: buyFees + fill.fee,
      durationMs,
      durationDays: durationMs / MS_PER_DAY,
      exitReason: "signal",
    });
  }

  const openPositions: ReportOpenPosition[] = openLots.map((lot) => {
    const cost = lot.quantity * lot.price + lot.fee;
    const marketValue = lot.quantity * markPrice;
    return {
      entryTimestamp: new Date(lot.executedAt).toISOString(),
      entryPrice: lot.price,
      quantity: lot.quantity,
      feesPaid: lot.fee,
      unrealizedPnl: marketValue - cost,
    };
  });

  return { roundTrips, openPositions };
}

export function fillsToReportFills(fills: SimulatedFill[]): ReportFill[] {
  return fills.map((f, i) => ({
    fillIndex: i,
    side: f.side,
    timestamp: new Date(f.executedAt).toISOString(),
    price: f.price,
    quantity: f.quantity,
    quoteAmount: f.quoteAmount,
    fee: f.fee,
  }));
}

function computeDrawdown(equityCurve: EquitySample[]): DrawdownStats {
  if (equityCurve.length === 0) {
    return { maxDrawdownPct: 0, maxDrawdownDurationDays: 0 };
  }

  let peak = equityCurve[0].equity;
  let peakTime = equityCurve[0].timestamp;
  let maxDrawdownPct = 0;
  let maxDurationMs = 0;
  let currentDrawdownStart: number | null = null;

  for (const sample of equityCurve) {
    if (sample.equity >= peak) {
      if (currentDrawdownStart !== null) {
        const duration = sample.timestamp - currentDrawdownStart;
        if (duration > maxDurationMs) maxDurationMs = duration;
        currentDrawdownStart = null;
      }
      peak = sample.equity;
      peakTime = sample.timestamp;
    } else {
      if (currentDrawdownStart === null) currentDrawdownStart = peakTime;
      const dd = peak > 0 ? ((peak - sample.equity) / peak) * 100 : 0;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    }
  }

  // Still underwater at the end — count duration to last sample.
  if (currentDrawdownStart !== null) {
    const last = equityCurve[equityCurve.length - 1];
    const duration = last.timestamp - currentDrawdownStart;
    if (duration > maxDurationMs) maxDurationMs = duration;
  }

  return {
    maxDrawdownPct,
    maxDrawdownDurationDays: maxDurationMs / MS_PER_DAY,
  };
}

function periodReturns(equityCurve: EquitySample[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    if (prev > 0) returns.push((equityCurve[i].equity - prev) / prev);
  }
  return returns;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function annualizedSharpe(returns: number[], periodsPerYear: number): number | null {
  if (returns.length < 2) return null;
  const m = mean(returns);
  const s = stdDev(returns);
  if (s === 0) return null;
  return (m / s) * Math.sqrt(periodsPerYear);
}

function annualizedSortino(returns: number[], periodsPerYear: number): number | null {
  if (returns.length < 2) return null;
  const m = mean(returns);
  const downside = returns.filter((r) => r < 0);
  if (downside.length === 0) return null;
  const downsideDev = Math.sqrt(mean(downside.map((r) => r ** 2)));
  if (downsideDev === 0) return null;
  return (m / downsideDev) * Math.sqrt(periodsPerYear);
}

function cagr(initial: number, final: number, periodMs: number): number | null {
  if (periodMs < MS_PER_DAY || initial <= 0 || final <= 0) return null;
  const years = periodMs / (365.25 * MS_PER_DAY);
  return (Math.pow(final / initial, 1 / years) - 1) * 100;
}

export function computeBenchmark(
  initialBalance: number,
  firstPrice: number,
  lastPrice: number,
  feeRate: number,
  strategyReturnPct: number
): BenchmarkComparison {
  const coins = (initialBalance * (1 - feeRate)) / firstPrice;
  const buyAndHoldFinalEquity = coins * lastPrice;
  const buyAndHoldPnl = buyAndHoldFinalEquity - initialBalance;
  const buyAndHoldReturnPct =
    initialBalance > 0 ? (buyAndHoldPnl / initialBalance) * 100 : 0;

  return {
    buyAndHoldReturnPct,
    buyAndHoldPnl,
    buyAndHoldFinalEquity,
    excessReturnPct: strategyReturnPct - buyAndHoldReturnPct,
    beatBuyAndHold: strategyReturnPct > buyAndHoldReturnPct,
    firstPrice,
    lastPrice,
  };
}

export function classifyMarketRegime(
  closes: number[],
  interval: string,
  periodMs: number
): MarketRegimeContext {
  if (closes.length < 2) {
    return {
      label: "ranging",
      summary: "Insufficient price data to classify the market regime.",
      priceReturnPct: 0,
      annualizedVolatilityPct: 0,
      trendSlopePerYear: 0,
    };
  }

  const first = closes[0];
  const last = closes[closes.length - 1];
  const priceReturnPct = first > 0 ? ((last - first) / first) * 100 : 0;

  const logReturns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) {
      logReturns.push(Math.log(closes[i] / closes[i - 1]));
    }
  }

  const periodsPerYear = INTERVAL_PERIODS_PER_YEAR[interval] ?? 8_760;
  const perPeriodVol = stdDev(logReturns);
  const annualizedVolatilityPct = perPeriodVol * Math.sqrt(periodsPerYear) * 100;

  const years = periodMs / (365.25 * MS_PER_DAY);
  const trendSlopePerYear =
    years > 0 && first > 0 && last > 0 ? Math.log(last / first) / years : 0;

  let label: MarketRegimeLabel;
  if (annualizedVolatilityPct >= 60) {
    label = "volatile";
  } else if (priceReturnPct >= 8) {
    label = "trending_up";
  } else if (priceReturnPct <= -8) {
    label = "trending_down";
  } else {
    label = "ranging";
  }

  const summaries: Record<MarketRegimeLabel, string> = {
    trending_up:
      "Prices rose meaningfully over the period with moderate volatility — trend-following strategies tend to fare better than mean-reversion here.",
    trending_down:
      "Prices fell over the period — dip-buying and mean-reversion strategies often struggle; buy-and-hold also loses.",
    ranging:
      "Prices moved sideways with limited net change — grid and range-bound strategies are typically a better fit than pure trend-following.",
    volatile:
      "Large price swings relative to the net move — high whipsaw risk for MA crossover; grid can profit if range is respected but fee drag rises with trade count.",
  };

  return {
    label,
    summary: summaries[label],
    priceReturnPct,
    annualizedVolatilityPct,
    trendSlopePerYear,
  };
}

export interface AnalyticsInput {
  initialBalance: number;
  finalEquity: number;
  feeRate: number;
  equityCurve: EquitySample[];
  fills: SimulatedFill[];
  interval: string;
  periodStartMs: number;
  periodEndMs: number;
  firstPrice: number;
  lastPrice: number;
  closes: number[];
}

export function computePerformanceMetrics(input: AnalyticsInput): {
  performance: PerformanceMetrics;
  benchmark: BenchmarkComparison;
  marketRegime: MarketRegimeContext;
  roundTrips: ReportRoundTrip[];
  openPositions: ReportOpenPosition[];
} {
  const { roundTrips, openPositions } = buildRoundTrips(
    input.fills,
    input.feeRate,
    input.lastPrice
  );
  const totalReturnPct =
    input.initialBalance > 0
      ? ((input.finalEquity - input.initialBalance) / input.initialBalance) * 100
      : 0;
  const totalPnl = input.finalEquity - input.initialBalance;
  const periodMs = input.periodEndMs - input.periodStartMs;
  const periodsPerYear = INTERVAL_PERIODS_PER_YEAR[input.interval] ?? 8_760;

  const { maxDrawdownPct, maxDrawdownDurationDays } = computeDrawdown(input.equityCurve);
  const returns = periodReturns(input.equityCurve);

  const wins = roundTrips.filter((t) => t.netPnl > 0);
  const losses = roundTrips.filter((t) => t.netPnl < 0);
  const grossProfit = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = losses.reduce((s, t) => s + Math.abs(t.netPnl), 0);

  const performance: PerformanceMetrics = {
    totalReturnPct,
    totalPnl,
    cagrPct: cagr(input.initialBalance, input.finalEquity, periodMs),
    maxDrawdownPct,
    maxDrawdownDurationDays,
    sharpeRatio: annualizedSharpe(returns, periodsPerYear),
    sortinoRatio: annualizedSortino(returns, periodsPerYear),
    winRatePct:
      roundTrips.length > 0 ? (wins.length / roundTrips.length) * 100 : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : wins.length > 0 ? null : null,
    averageWin: wins.length > 0 ? grossProfit / wins.length : null,
    averageLoss: losses.length > 0 ? -grossLoss / losses.length : null,
    winLossRatio:
      losses.length > 0 && wins.length > 0
        ? grossProfit / wins.length / (grossLoss / losses.length)
        : null,
    fillCount: input.fills.length,
    roundTripCount: roundTrips.length,
    averageTradeDurationDays:
      roundTrips.length > 0
        ? mean(roundTrips.map((t) => t.durationDays))
        : null,
    largestWin: wins.length > 0 ? Math.max(...wins.map((t) => t.netPnl)) : null,
    largestLoss:
      losses.length > 0 ? Math.min(...losses.map((t) => t.netPnl)) : null,
  };

  const benchmark = computeBenchmark(
    input.initialBalance,
    input.firstPrice,
    input.lastPrice,
    input.feeRate,
    totalReturnPct
  );

  const marketRegime = classifyMarketRegime(input.closes, input.interval, periodMs);

  return { performance, benchmark, marketRegime, roundTrips, openPositions };
}
