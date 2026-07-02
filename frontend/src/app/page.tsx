"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type PaperSession, type Strategy } from "@/lib/api";
import { StrategyCard } from "@/components/StrategyCard";
import { dateTime, money } from "@/lib/format";

export default function HomePage() {
  const [strategies, setStrategies] = useState<Strategy[] | null>(null);
  const [sessions, setSessions] = useState<PaperSession[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getStrategies().then(setStrategies).catch((err) => setError(err.message));
    api.getPaperSessions().then(setSessions).catch(() => setSessions([]));
  }, []);

  return (
    <div className="space-y-12">
      <section>
        <h1 className="text-3xl font-bold tracking-tight">
          Learn trading strategies. <span className="text-indigo-400">Risk nothing.</span>
        </h1>
        <p className="mt-3 max-w-2xl leading-relaxed text-slate-400">
          Pick a strategy below, read how it works in plain language, then test it two
          ways: against real market history (backtesting) or live prices with pretend
          money (paper trading). No account, no real funds, no jargon.
        </p>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold">Strategy library</h2>
        {error ? (
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </p>
        ) : strategies === null ? (
          <p className="text-sm text-slate-500">Loading strategies…</p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2">
            {strategies.map((s) => (
              <StrategyCard key={s.id} strategy={s} />
            ))}
          </div>
        )}
      </section>

      {sessions.length > 0 ? (
        <section>
          <h2 className="mb-4 text-xl font-semibold">Your trading sessions</h2>
          <div className="overflow-hidden rounded-xl border border-slate-800">
            {sessions.map((s) => (
              <Link
                key={s.id}
                href={`/paper/${s.id}`}
                className="flex items-center justify-between border-b border-slate-800/60 bg-slate-900/50 px-5 py-4 transition last:border-0 hover:bg-slate-900"
              >
                <div>
                  <span className="font-medium">
                    {s.config?.strategy.name ?? "Strategy"} · session #{s.id}
                  </span>
                  {s.kind === "live_testnet" ? (
                    <span className="ml-3 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-400">
                      testnet
                    </span>
                  ) : null}
                  <span className="ml-3 text-xs text-slate-500">
                    started {dateTime(s.startedAt)}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-mono text-sm text-slate-400">
                    ${money(s.quoteBalance)} cash
                  </span>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                      s.status === "running"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                        : "border-slate-600 bg-slate-800 text-slate-400"
                    }`}
                  >
                    {s.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
