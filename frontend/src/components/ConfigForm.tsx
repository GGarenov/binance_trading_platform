"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Strategy } from "@/lib/api";

interface FieldSpec {
  key: string;
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
      help: "Which coin to buy, priced in USDT. BTCUSDT means buying Bitcoin with dollars (USDT).",
      type: "pair",
    },
    {
      key: "amountPerBuy",
      label: "Amount per buy (USDT)",
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
      help: "Which coin to trade, priced in USDT.",
      type: "pair",
    },
    {
      key: "lowerBound",
      label: "Lower price bound (USDT)",
      help: "Bottom of the price range. Below this the grid stops buying.",
      type: "number",
      min: 0.00000001,
    },
    {
      key: "upperBound",
      label: "Upper price bound (USDT)",
      help: "Top of the price range. Above this everything has been sold.",
      type: "number",
      min: 0.00000001,
    },
    {
      key: "gridLevels",
      label: "Number of grid levels",
      help: "How many price lines the range is split into. More levels = smaller, more frequent trades.",
      type: "number",
      min: 2,
      step: 1,
    },
    {
      key: "amountPerLevel",
      label: "Amount per level (USDT)",
      help: "How much simulated money each grid-level purchase spends.",
      type: "number",
      min: 1,
      step: 1,
    },
  ],
};

function todayMinusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function ConfigForm({ strategy }: { strategy: Strategy }) {
  const router = useRouter();
  const fields = FIELD_SPECS[strategy.slug] ?? [];

  const [values, setValues] = useState<Record<string, unknown>>(strategy.defaultParams);
  const [symbols, setSymbols] = useState<string[]>([]);

  // Backtest options
  const [startDate, setStartDate] = useState(todayMinusDays(90));
  const [endDate, setEndDate] = useState(todayMinusDays(0));
  const [backtestBalance, setBacktestBalance] = useState(10000);

  // Paper trading options
  const [paperBalance, setPaperBalance] = useState(10000);

  const [busy, setBusy] = useState<"backtest" | "paper" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSymbols()
      .then((r) => setSymbols(r.symbols.map((s) => s.symbol)))
      .catch(() => setSymbols([])); // datalist is a convenience; typing still works
  }, []);

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
      const session = await api.startPaperSession(configId, paperBalance);
      router.push(`/paper/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none";

  const paramFields = useMemo(
    () =>
      fields.map((field) => (
        <label key={field.key} className="block">
          <span className="text-sm font-medium text-slate-300">{field.label}</span>
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
      )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fields, values]
  );

  return (
    <div className="space-y-6">
      <datalist id="symbols">
        {symbols.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <h3 className="text-base font-semibold">1. Configure the strategy</h3>
        <p className="mt-1 text-sm text-slate-400">
          Sensible defaults are pre-filled — you can run them as-is.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">{paramFields}</div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <h3 className="text-base font-semibold">2a. Test against the past</h3>
          <p className="mt-1 text-sm text-slate-400">
            Backtesting replays real historical prices to show how this setup{" "}
            <em>would have</em> performed. Past results never guarantee future ones.
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
                Starting balance (USDT)
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
          <h3 className="text-base font-semibold">2b. Test it live (paper trading)</h3>
          <p className="mt-1 text-sm text-slate-400">
            Paper trading runs the strategy against <em>live</em> market prices with a
            simulated balance. It keeps running on the server until you stop it.
          </p>
          <div className="mt-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-300">
                Starting balance (USDT)
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
          <button
            onClick={handlePaper}
            disabled={busy !== null}
            className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy === "paper" ? "Starting session…" : "Start paper trading"}
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
