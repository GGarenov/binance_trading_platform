// Single place where the frontend talks to the backend. Every page imports
// typed functions from here instead of calling fetch() directly, so URLs,
// error handling and response shapes live in one file.

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type RiskLevel = "low" | "medium" | "high";

export interface Strategy {
  id: number;
  slug: string;
  name: string;
  description: string;
  howItWorks: string;
  whenItWorks: string;
  whenItDoesnt: string;
  riskLevel: RiskLevel;
  defaultParams: Record<string, unknown>;
}

export interface StrategyConfig {
  id: number;
  strategyId: number;
  params: Record<string, unknown>;
  createdAt: string;
}

export interface EquitySample {
  timestamp: number;
  equity: number;
}

export interface BacktestResults {
  initialBalance: number;
  feeRate: number;
  slippageBps: number;
  finalQuoteBalance: number;
  finalBaseBalance: number;
  finalEquity: number;
  pnl: number;
  pnlPct: number;
  feesPaid: number;
  winRate: number | null;
  tradeCount: number;
  equityCurve: EquitySample[];
}

export interface BacktestRun {
  id: number;
  configId: number;
  startDate: string;
  endDate: string;
  interval: string;
  status: "pending" | "completed" | "failed";
  results: BacktestResults | null;
  error: string | null;
  createdAt: string;
  config?: { strategy: { slug: string; name: string }; params: Record<string, unknown> };
}

// NOTE: numeric DB columns (NUMERIC) arrive as strings in JSON — convert with
// Number() before doing math. The formatters in format.ts accept both.
export interface SimulatedTrade {
  id: number;
  side: "buy" | "sell";
  price: string;
  quantity: string;
  quoteAmount: string;
  fee: string;
  /** Price the strategy decided at. On live sessions `price` is the real fill,
   * so the gap between the two is the observed slippage. Null on backtests. */
  intendedPrice: string | null;
  executedAt: string;
}

export type SessionKind = "paper" | "live_testnet" | "live_real";

export interface PaperSessionLive {
  currentPrice: number;
  priceUpdatedAt: number;
  equity: number;
  quoteBalance: number;
  baseBalance: number;
}

export interface PaperSession {
  id: number;
  configId: number;
  status: "running" | "stopped";
  kind: SessionKind;
  initialBalance: string;
  quoteBalance: string;
  baseBalance: string;
  startedAt: string;
  stoppedAt: string | null;
  config?: { strategy: { slug: string; name: string }; params: Record<string, unknown> };
  live?: PaperSessionLive | null;
  unrealizedPnl?: number | null;
}

export interface SymbolInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new Error(
      "Cannot reach the backend. Is the API server running on " + API_BASE + "?"
    );
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  getStrategies: () => apiFetch<Strategy[]>("/api/strategies"),
  getStrategy: (slug: string) => apiFetch<Strategy>(`/api/strategies/${slug}`),

  createConfig: (strategyId: number, params: Record<string, unknown>) =>
    apiFetch<StrategyConfig>("/api/configs", {
      method: "POST",
      body: JSON.stringify({ strategyId, params }),
    }),

  runBacktest: (body: {
    configId: number;
    startDate: string;
    endDate: string;
    interval?: string;
    initialBalance?: number;
  }) => apiFetch<BacktestRun>("/api/backtests", { method: "POST", body: JSON.stringify(body) }),
  getBacktest: (id: number) => apiFetch<BacktestRun>(`/api/backtests/${id}`),
  getBacktestTrades: (id: number) => apiFetch<SimulatedTrade[]>(`/api/backtests/${id}/trades`),

  /** Downloads the standardized JSON backtest report (attachment). */
  downloadBacktestReport: async (id: number): Promise<void> => {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/api/backtests/${id}/export`);
    } catch {
      throw new Error(
        "Cannot reach the backend. Is the API server running on " + API_BASE + "?"
      );
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `Download failed (${response.status})`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `backtest-${id}-report.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },

  startPaperSession: (
    configId: number,
    initialBalance: number,
    kind: "paper" | "live_testnet" = "paper"
  ) =>
    apiFetch<PaperSession>("/api/paper-sessions", {
      method: "POST",
      body: JSON.stringify({ configId, initialBalance, kind }),
    }),
  getPaperSessions: () => apiFetch<PaperSession[]>("/api/paper-sessions"),
  getPaperSession: (id: number) => apiFetch<PaperSession>(`/api/paper-sessions/${id}`),
  stopPaperSession: (id: number) =>
    apiFetch<PaperSession>(`/api/paper-sessions/${id}/stop`, { method: "POST" }),
  getPaperSessionTrades: (id: number) =>
    apiFetch<SimulatedTrade[]>(`/api/paper-sessions/${id}/trades`),

  getSymbols: (quote: "USDT" | "USDC" = "USDT") =>
    apiFetch<{ count: number; symbols: SymbolInfo[] }>(`/api/market/symbols?quote=${quote}`),
};
