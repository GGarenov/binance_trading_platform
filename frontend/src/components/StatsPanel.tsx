interface Stat {
  label: string;
  value: string;
  /** Colors the value green/red for gains/losses. */
  tone?: "positive" | "negative" | "neutral";
  hint?: string;
}

const TONE_CLASS = {
  positive: "text-emerald-400",
  negative: "text-red-400",
  neutral: "text-slate-100",
};

export function StatsPanel({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-xl border border-slate-800 bg-slate-900/50 p-4"
          title={stat.hint}
        >
          <div className="text-xs uppercase tracking-wide text-slate-500">{stat.label}</div>
          <div className={`mt-1 text-xl font-semibold ${TONE_CLASS[stat.tone ?? "neutral"]}`}>
            {stat.value}
          </div>
          {stat.hint ? <div className="mt-1 text-xs text-slate-500">{stat.hint}</div> : null}
        </div>
      ))}
    </div>
  );
}
