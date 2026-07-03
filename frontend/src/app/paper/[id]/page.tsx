"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, type PaperSession, type SimulatedTrade } from "@/lib/api";
import { StatsPanel } from "@/components/StatsPanel";
import { TradeLog } from "@/components/TradeLog";
import { dateTime, money, quantity, signedMoney } from "@/lib/format";

const POLL_MS = 3000;

export default function PaperSessionPage() {
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);

  const [session, setSession] = useState<PaperSession | null>(null);
  const [trades, setTrades] = useState<SimulatedTrade[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.getPaperSession(sessionId).then(setSession).catch((err) => setError(err.message));
    api.getPaperSessionTrades(sessionId).then(setTrades).catch(() => {});
  }, [sessionId]);

  // Poll every few seconds while the page is open. Simple and reliable; the
  // session itself lives on the server, so closing this page loses nothing.
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      await api.downloadSessionReport(sessionId);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  const handleStop = async () => {
    if (!confirm("Stop this paper trading session? It cannot be resumed.")) return;
    setStopping(true);
    try {
      await api.stopPaperSession(sessionId);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStopping(false);
    }
  };

  if (error) {
    return (
      <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
        {error}
      </p>
    );
  }
  if (!session) return <p className="text-sm text-slate-500">Loading session…</p>;

  const running = session.status === "running";
  const isTestnet = session.kind === "live_testnet";
  const live = session.live ?? null;
  const initial = Number(session.initialBalance);

  // While live data hasn't arrived yet (or the session is stopped), fall back
  // to the persisted balances so the page always shows something truthful.
  const cash = live ? live.quoteBalance : Number(session.quoteBalance);
  const coins = live ? live.baseBalance : Number(session.baseBalance);
  const equity = live ? live.equity : null;
  const pnl = session.unrealizedPnl ?? null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-indigo-400">
            ← All strategies
          </Link>
          <h1 className="mt-3 flex items-center gap-3 text-2xl font-bold tracking-tight">
            {isTestnet ? "Testnet session" : "Paper session"} #{session.id} —{" "}
            {session.config?.strategy.name ?? "Strategy"}
            <span
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                running
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  : "border-slate-600 bg-slate-800 text-slate-400"
              }`}
            >
              {running ? "● running" : "stopped"}
            </span>
            {isTestnet ? (
              <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 text-xs font-medium text-sky-400">
                real orders · fake money
              </span>
            ) : null}
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Trading {String(session.config?.params?.pair ?? "?")}{" "}
            {isTestnet
              ? "with real orders on the Binance Spot Testnet since"
              : "with simulated funds since"}{" "}
            {dateTime(session.startedAt)}.
            {running
              ? " Live prices from Binance; this page refreshes every few seconds."
              : session.stoppedAt
                ? ` Stopped ${dateTime(session.stoppedAt)}.`
                : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="rounded-lg border border-indigo-500/50 bg-indigo-500/10 px-4 py-2 text-sm font-medium text-indigo-300 transition hover:bg-indigo-500/20 disabled:opacity-50"
          >
            {downloading ? "Preparing…" : "Download report (JSON)"}
          </button>
          {running ? (
            <button
              onClick={handleStop}
              disabled={stopping}
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
            >
              {stopping ? "Stopping…" : "Stop session"}
            </button>
          ) : null}
        </div>
      </div>
      {downloadError ? (
        <p className="text-sm text-red-400">{downloadError}</p>
      ) : null}

      <StatsPanel
        stats={[
          {
            label: "Current price",
            value: live ? `$${money(live.currentPrice)}` : "waiting…",
            hint: running ? undefined : "Live price only shown while running",
          },
          {
            label: "Account value",
            value: equity !== null ? `$${money(equity)}` : `$${money(cash)}`,
            hint: `Started with $${money(initial)}`,
          },
          {
            label: "Unrealized P&L",
            value: pnl !== null ? signedMoney(pnl) : "—",
            tone: pnl === null ? "neutral" : pnl >= 0 ? "positive" : "negative",
            hint: "How the account stands right now vs. its starting balance",
          },
          {
            label: "Holdings",
            value: quantity(coins),
            hint: `plus $${money(cash)} in cash`,
          },
          {
            label: "Fees paid",
            value: `$${money(trades.reduce((sum, t) => sum + Number(t.fee ?? 0), 0))}`,
            hint: isTestnet
              ? "Actual exchange commission from testnet fills"
              : "0.10% per trade, like real Binance",
          },
        ]}
      />

      <section>
        <h2 className="mb-3 text-lg font-semibold">Trade log ({trades.length} trades)</h2>
        {isTestnet ? (
          <p className="mb-3 text-sm text-slate-500">
            &ldquo;Intended&rdquo; is the price the strategy decided at; &ldquo;Filled&rdquo;
            is what the testnet exchange actually gave us. The gap is real slippage.
          </p>
        ) : null}
        <TradeLog trades={trades} showIntended={isTestnet} />
        {running && trades.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            The strategy is watching the market and will trade when its conditions are
            met — for DCA that&apos;s the next scheduled buy; for Grid it&apos;s the price
            crossing a grid level. Depending on your settings this can take a while.
          </p>
        ) : null}
      </section>
    </div>
  );
}
