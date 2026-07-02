"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, type Strategy } from "@/lib/api";
import { ConfigForm } from "@/components/ConfigForm";
import { RiskBadge } from "@/components/RiskBadge";

export default function StrategyPage() {
  const { slug } = useParams<{ slug: string }>();
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getStrategy(slug).then(setStrategy).catch((err) => setError(err.message));
  }, [slug]);

  if (error) {
    return (
      <div className="space-y-4">
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
        <Link href="/" className="text-sm text-indigo-400">
          ← Back to the strategy library
        </Link>
      </div>
    );
  }
  if (!strategy) {
    return <p className="text-sm text-slate-500">Loading strategy…</p>;
  }

  return (
    <div className="space-y-10">
      <div>
        <Link href="/" className="text-sm text-indigo-400">
          ← All strategies
        </Link>
        <div className="mt-3 flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">{strategy.name}</h1>
          <RiskBadge level={strategy.riskLevel} />
        </div>
        <p className="mt-3 max-w-2xl leading-relaxed text-slate-400">
          {strategy.description}
        </p>
      </div>

      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <h2 className="text-lg font-semibold">How it works</h2>
        <p className="mt-2 leading-relaxed text-slate-300">{strategy.howItWorks}</p>
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6">
          <h3 className="font-semibold text-emerald-400">When it works well</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            {strategy.whenItWorks}
          </p>
        </div>
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6">
          <h3 className="font-semibold text-red-400">When it doesn&apos;t</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            {strategy.whenItDoesnt}
          </p>
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold">Try it — with simulated money</h2>
        <ConfigForm strategy={strategy} />
      </section>
    </div>
  );
}
