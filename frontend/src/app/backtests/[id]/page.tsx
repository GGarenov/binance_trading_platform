"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, type BacktestRun, type SimulatedTrade } from "@/lib/api";
import { EquityChart } from "@/components/EquityChart";
import { StatsPanel } from "@/components/StatsPanel";
import { TradeLog } from "@/components/TradeLog";
import { money, percent, shortDate, signedMoney } from "@/lib/format";

export default function BacktestPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<BacktestRun | null>(null);
  const [trades, setTrades] = useState<SimulatedTrade[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    const runId = Number(id);
    api.getBacktest(runId).then(setRun).catch((err) => setError(err.message));
    api.getBacktestTrades(runId).then(setTrades).catch(() => setTrades([]));
  }, [id]);

  if (error) {
    return (
      <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
        {error}
      </p>
    );
  }
  if (!run) return <p className="text-sm text-slate-500">Loading backtest…</p>;

  if (run.status === "failed") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Backtest #{run.id} failed</h1>
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {run.error ?? "Unknown error"}
        </p>
        <Link href="/" className="text-sm text-indigo-400">
          ← Back to the strategy library
        </Link>
      </div>
    );
  }

  const results = run.results;
  if (!results) return <p className="text-sm text-slate-500">Backtest is still running…</p>;

  const gained = results.pnl >= 0;

  async function handleDownload() {
    setDownloading(true);
    setDownloadError(null);
    try {
      await api.downloadBacktestReport(run.id);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <Link href="/" className="text-sm text-indigo-400">
          ← All strategies
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Backtest #{run.id} — {run.config?.strategy.name ?? "Strategy"}
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              Simulated from {shortDate(run.startDate)} to {shortDate(run.endDate)} on{" "}
              {String(run.config?.params?.pair ?? "?")} using {run.interval} candles. Trades
              execute at candle close and pay a {((run.results?.feeRate ?? 0.001) * 100).toFixed(2)}%
              fee per fill, like the real exchange.
            </p>
          </div>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="shrink-0 rounded-lg border border-indigo-500/50 bg-indigo-500/10 px-4 py-2 text-sm font-medium text-indigo-300 transition hover:bg-indigo-500/20 disabled:opacity-50"
          >
            {downloading ? "Preparing…" : "Download report (JSON)"}
          </button>
        </div>
        {downloadError ? (
          <p className="mt-2 text-sm text-red-400">{downloadError}</p>
        ) : null}
      </div>

      <StatsPanel
        stats={[
          {
            label: "Started with",
            value: `$${money(results.initialBalance)}`,
          },
          {
            label: "Ended with",
            value: `$${money(results.finalEquity)}`,
            hint: "Cash + coins valued at the final price",
          },
          {
            label: "Profit / loss",
            value: `${signedMoney(results.pnl)} (${percent(results.pnlPct)})`,
            tone: gained ? "positive" : "negative",
          },
          {
            label: "Win rate",
            value:
              results.winRate === null
                ? "n/a"
                : `${(results.winRate * 100).toFixed(0)}%`,
            hint:
              results.winRate === null
                ? "This strategy only accumulates — it never sells, so win rate doesn't apply"
                : "Share of sells that beat their buy price after fees",
          },
          {
            label: "Fees paid",
            value: `$${money(results.feesPaid ?? 0)}`,
            hint: `${((results.feeRate ?? 0) * 100).toFixed(2)}% per trade, like real Binance`,
          },
        ]}
      />

      <section>
        <h2 className="mb-3 text-lg font-semibold">Account value over time</h2>
        <EquityChart curve={results.equityCurve} initialBalance={results.initialBalance} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">
          Trade log ({results.tradeCount} trades)
        </h2>
        <TradeLog trades={trades} />
      </section>
    </div>
  );
}
