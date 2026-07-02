import Link from "next/link";
import type { Strategy } from "@/lib/api";
import { RiskBadge } from "./RiskBadge";

export function StrategyCard({ strategy }: { strategy: Strategy }) {
  return (
    <Link
      href={`/strategies/${strategy.slug}`}
      className="block rounded-xl border border-slate-800 bg-slate-900/50 p-6 transition hover:border-indigo-500/50 hover:bg-slate-900"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold">{strategy.name}</h2>
        <RiskBadge level={strategy.riskLevel} />
      </div>
      <p className="mt-3 text-sm leading-relaxed text-slate-400">{strategy.description}</p>
      <span className="mt-4 inline-block text-sm font-medium text-indigo-400">
        Learn more &amp; configure →
      </span>
    </Link>
  );
}
