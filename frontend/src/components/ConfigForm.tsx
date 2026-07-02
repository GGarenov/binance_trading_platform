"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Strategy } from "@/lib/api";

type Quote = "USDT" | "USDC";

interface FieldSpec {
  key: string;
  /** `{quote}` is replaced with the selected quote currency at render time. */
  label: string;
  help: string;
  type: "pair" | "number" | "select";
  options?: { value: string; label: string }[];
  min?: number;
  step?: number;
}

// What the user can configure, per strategy. Matches the zod schemas on the
// backend — the backend re-validates everything, this just drives the UI.
const FIELD_SPECS: Record<string, FieldSpec[]> = {
  dca: [
    {
      key: "pair",
      label: "Trading pair",
      help: "Which coin to buy. BTCUSDT means buying Bitcoin with USDT; SOLUSDC means buying Solana with USDC.",
      type: "pair",
    },
    {
      key: "amountPerBuy",
      label: "Amount per buy ({quote})",
      help: "How much simulated money each single purchase spends.",
      type: "number",
      min: 1,
      step: 1,
    },
    {
      key: "interval",
      label: "Buy interval",
      help: "How often a purchase happens.",
      type: "select",
      options: [
        { value: "daily", label: "Every day" },
        { value: "weekly", label: "Every week" },
      ],
    },
    {
      key: "durationDays",
      label: "Duration (days)",
      help: "How long the strategy keeps buying, counted from its first purchase.",
      type: "number",
      min: 1,
      step: 1,
    },
  ],
  grid: [
    {
      key: "pair",
      label: "Trading pair",
      help: "Which coin to trade.",
      type: "pair",
    },
    {
      key: "lowerBound",
      label: "Lower price bound ({quote})",
      help: "Bottom of the price range. Below this the grid stops buying.",
      type: "number",
      min: 0.00000001,
    },
    {
      key: "upperBound",
      label: "Upper price bound ({quote})",
      help: "Top of the price range. Above this everything has been sold.",
      type: "number",
      min: 0.00000001,
    },
    {
      key: "gridLevels",
      label: "Number of grid levels",
      help: "How many price lines the range is split into. More levels = smaller, more frequent trades — but each trip earns less, and fees stay the same.",
      type: "number",
      min: 2,
      step: 1,
    },
    {
      key: "amountPerLevel",
      label: "Amount per level ({quote})",
      help: "How much simulated money each grid-level purchase spends.",
      type: "number",
      min: 1,
      step: 1,
    },
  ],
  "ma-crossover": [
    {
      key: "pair",
      label: "Trading pair",
      help: "Which coin to trade.",
      type: "pair",
    },
    {
      key: "shortPeriod",
      label: "Fast average (hours)",
      help: "The short-term average that reacts quickly to price moves. Must be smaller than the slow average.",
      type: "number",
      min: 2,
      step: 1,
    },
    {
      key: "longPeriod",
      label: "Slow average (hours)",
      help: "The long-term average representing the underlying trend.",
      type: "number",
      min: 3,
      step: 1,
    },
    {
      key: "amountPerEntry",
      label: "Amount per entry ({quote})",
      help: "How much is invested each time a buy signal fires. One position at a time.",
      type: "number",
      min: 1,
      step: 1,
    },
  ],
  "rsi-reversion": [
    {
      key: "pair",
      label: "Trading pair",
      help: "Which coin to trade.",
      type: "pair",
    },
    {
      key: "rsiPeriod",
      label: "RSI period (hours)",
      help: "How far back the overbought/oversold gauge looks. 14 is the textbook default.",
      type: "number",
      min: 2,
      step: 1,
    },
    {
      key: "oversold",
      label: "Oversold threshold",
      help: "Buy when RSI drops below this. Lower = only buys deeper panics (fewer, stronger signals).",
      type: "number",
      min: 1,
      step: 1,
    },
    {
      key: "overbought",
      label: "Overbought threshold",
      help: "Sell when RSI rises above this. Higher = waits for more euphoria before selling.",
      type: "number",
      min: 50,
      step: 1,
    },
    {
      key: "amountPerEntry",
      label: "Amount per entry ({quote})",
      help: "How much is invested each time a buy signal fires. One position at a time.",
      type: "number",
      min: 1,
      step: 1,
    },
  ],
};

/** Binance spot taker fee per side; a grid round trip costs about twice this. */
const FEE_RATE = 0.001;

function todayMinusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function ConfigForm({ strategy }: { strategy: Strategy }) {
  const router = useRouter();
  const fields = FIELD_SPECS[strategy.slug] ?? [];

  const [values, setValues] = useState<Record<string, unknown>>(strategy.defaultParams);
  const [quote, setQuote] = useState<Quote>("USDT");
  const [symbols, setSymbols] = useState<string[]>([]);

  // Backtest options
  const [startDate, setStartDate] = useState(todayMinusDays(90));
  const [endDate, setEndDate] = useState(todayMinusDays(0));
  const [backtestBalance, setBacktestBalance] = useState(10000);

  // Paper trading options
  const [paperBalance, setPaperBalance] = useState(10000);
  const [sessionKind, setSessionKind] = useState<"paper" | "live_testnet">("paper");

  const [busy, setBusy] = useState<"backtest" | "paper" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSymbols(quote)
      .then((r) => setSymbols(r.symbols.map((s) => s.symbol)))
      .catch(() => setSymbols([])); // datalist is a convenience; typing still works
  }, [quote]);

  const handleQuoteChange = (next: Quote) => {
    setQuote(next);
    // Keep the pair consistent: BTCUSDT → BTCUSDC when switching quote.
    setValues((prev) => {
      const pair = String(prev.pair ?? "");
      const old: Quote = next === "USDT" ? "USDC" : "USDT";
      return pair.endsWith(old)
        ? { ...prev, pair: pair.slice(0, -old.length) + next }
        : prev;
    });
  };

  const setField = (key: string, raw: string, type: FieldSpec["type"]) => {
    setValues((prev) => ({
      ...prev,
      [key]: type === "number" ? Number(raw) : raw.toUpperCase(),
    }));
  };

  // Select fields keep their string value as-is (no uppercasing).
  const setSelect = (key: string, raw: string) => {
    setValues((prev) => ({ ...prev, [key]: raw }));
  };

  // Warn when grid spacing can't beat round-trip fees — such a grid loses
  // money on every completed trip, guaranteed.
  const gridFeeWarning = useMemo(() => {
    if (strategy.slug !== "grid") return null;
    const lower = Number(values.lowerBound);
    const upper = Number(values.upperBound);
    const levels = Number(values.gridLevels);
    if (!(lower > 0) || !(upper > lower) || !(levels >= 2)) return null;

    const stepPct = (upper - lower) / (levels - 1) / ((upper + lower) / 2);
    const roundTripFeePct = 2 * FEE_RATE;
    if (stepPct < roundTripFeePct) {
      return `Warning: with ${levels} levels, each grid step is ${(stepPct * 100).toFixed(3)}% — less than the ~${(roundTripFeePct * 100).toFixed(1)}% a round trip costs in fees. Every completed trade would lose money. Use fewer levels or a wider range.`;
    }
    if (stepPct < roundTripFeePct * 2.5) {
      return `Heads-up: each grid step is ${(stepPct * 100).toFixed(2)}%, close to the ~${(roundTripFeePct * 100).toFixed(1)}% round-trip fee. Most of each trade's profit will go to fees.`;
    }
    return null;
  }, [strategy.slug, values]);

  const createConfig = async () => {
    const config = await api.createConfig(strategy.id, values);
    return config.id;
  };

  const handleBacktest = async () => {
    setBusy("backtest");
    setError(null);
    try {
      const configId = await createConfig();
      const run = await api.runBacktest({
        configId,
        startDate: `${startDate}T00:00:00Z`,
        endDate: `${endDate}T00:00:00Z`,
        interval: "1h",
        initialBalance: backtestBalance,
      });
      router.push(`/backtests/${run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  const handlePaper = async () => {
    setBusy("paper");
    setError(null);
    try {
      const configId = await createConfig();
      const session = await api.startPaperSession(configId, paperBalance, sessionKind);
      router.push(`/paper/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none";

  const paramFields = fields.map((field) => (
    <label key={field.key} className="block">
      <span className="text-sm font-medium text-slate-300">
        {field.label.replace("{quote}", quote)}
      </span>
      {field.type === "select" ? (
        <select
          className={inputClass + " mt-1"}
          value={String(values[field.key] ?? "")}
          onChange={(e) => setSelect(field.key, e.target.value)}
        >
          {field.options!.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : field.type === "pair" ? (
        <input
          className={inputClass + " mt-1"}
          list="symbols"
          value={String(values[field.key] ?? "")}
          onChange={(e) => setField(field.key, e.target.value, field.type)}
        />
      ) : (
        <input
          className={inputClass + " mt-1"}
          type="number"
          min={field.min}
          step={field.step ?? "any"}
          value={Number(values[field.key] ?? 0)}
          onChange={(e) => setField(field.key, e.target.value, field.type)}
        />
      )}
      <span className="mt-1 block text-xs text-slate-500">{field.help}</span>
    </label>
  ));

  return (
    <div className="space-y-6">
      <datalist id="symbols">
        {symbols.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">1. Configure the strategy</h3>
            <p className="mt-1 text-sm text-slate-400">
              Sensible defaults are pre-filled — you can run them as-is.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            Quote currency
            <select
              className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
              value={quote}
              onChange={(e) => handleQuoteChange(e.target.value as Quote)}
            >
              <option value="USDT">USDT</option>
              <option value="USDC">USDC</option>
            </select>
          </label>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">{paramFields}</div>
        {gridFeeWarning ? (
          <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            {gridFeeWarning}
          </p>
        ) : null}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <h3 className="text-base font-semibold">2a. Test against the past</h3>
          <p className="mt-1 text-sm text-slate-400">
            Backtesting replays real historical prices to show how this setup{" "}
            <em>would have</em> performed, including Binance&apos;s 0.1% fee per trade.
            Past results never guarantee future ones.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-300">From</span>
              <input
                type="date"
                className={inputClass + " mt-1"}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-300">To</span>
              <input
                type="date"
                className={inputClass + " mt-1"}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium text-slate-300">
                Starting balance ({quote})
              </span>
              <input
                type="number"
                min={1}
                className={inputClass + " mt-1"}
                value={backtestBalance}
                onChange={(e) => setBacktestBalance(Number(e.target.value))}
              />
            </label>
          </div>
          <button
            onClick={handleBacktest}
            disabled={busy !== null}
            className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy === "backtest" ? "Running backtest…" : "Run backtest"}
          </button>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <h3 className="text-base font-semibold">2b. Test it live</h3>
          <p className="mt-1 text-sm text-slate-400">
            {sessionKind === "paper" ? (
              <>
                Paper trading runs the strategy against <em>live</em> market prices with
                a simulated balance (0.1% fee per trade, like the real exchange). It
                keeps running on the server until you stop it.
              </>
            ) : (
              <>
                Testnet trading places <em>real orders</em> on the Binance Spot Testnet
                — a practice exchange with fake money but real order matching. Fills
                come back at actual exchange prices, so you see real slippage.
              </>
            )}
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-300">Session type</span>
              <select
                className={inputClass + " mt-1"}
                value={sessionKind}
                onChange={(e) => setSessionKind(e.target.value as "paper" | "live_testnet")}
              >
                <option value="paper">Paper (simulated fills)</option>
                <option value="live_testnet">Testnet (real orders, fake money)</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-300">
                Starting balance ({quote})
              </span>
              <input
                type="number"
                min={1}
                className={inputClass + " mt-1"}
                value={paperBalance}
                onChange={(e) => setPaperBalance(Number(e.target.value))}
              />
            </label>
          </div>
          {sessionKind === "live_testnet" ? (
            <p className="mt-3 rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-xs text-sky-300">
              Requires Binance testnet API keys on the server, and the budget must fit
              inside the testnet wallet&apos;s free {quote} balance. Testnet prices can
              drift from the real market — that&apos;s part of the exercise.
            </p>
          ) : null}
          <button
            onClick={handlePaper}
            disabled={busy !== null}
            className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy === "paper"
              ? "Starting session…"
              : sessionKind === "paper"
                ? "Start paper trading"
                : "Start testnet trading"}
          </button>
        </div>
      </section>

      {error ? (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
