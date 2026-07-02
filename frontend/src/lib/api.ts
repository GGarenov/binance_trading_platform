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
  finalQuoteBalance: number;
  finalBaseBalance: number;
  finalEquity: number;
  pnl: number;
  pnlPct: number;
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
  executedAt: string;
}

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

  startPaperSession: (configId: number, initialBalance: number) =>
    apiFetch<PaperSession>("/api/paper-sessions", {
      method: "POST",
      body: JSON.stringify({ configId, initialBalance }),
    }),
  getPaperSessions: () => apiFetch<PaperSession[]>("/api/paper-sessions"),
  getPaperSession: (id: number) => apiFetch<PaperSession>(`/api/paper-sessions/${id}`),
  stopPaperSession: (id: number) =>
    apiFetch<PaperSession>(`/api/paper-sessions/${id}/stop`, { method: "POST" }),
  getPaperSessionTrades: (id: number) =>
    apiFetch<SimulatedTrade[]>(`/api/paper-sessions/${id}/trades`),

  getSymbols: () => apiFetch<{ count: number; symbols: SymbolInfo[] }>("/api/market/symbols"),
};
