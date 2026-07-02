import type { RiskLevel } from "@/lib/api";

const STYLES: Record<RiskLevel, string> = {
  low: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  medium: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  high: "bg-red-500/10 text-red-400 border-red-500/30",
};

const LABELS: Record<RiskLevel, string> = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk",
};

export function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span
      className={`inline-block text-xs font-medium border rounded-full px-2.5 py-0.5 ${STYLES[level]}`}
    >
      {LABELS[level]}
    </span>
  );
}
