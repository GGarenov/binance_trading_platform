"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EquitySample } from "@/lib/api";
import { money, shortDate } from "@/lib/format";

export function EquityChart({
  curve,
  initialBalance,
}: {
  curve: EquitySample[];
  initialBalance: number;
}) {
  const endedUp = curve.length > 0 && curve[curve.length - 1].equity >= initialBalance;
  const color = endedUp ? "#34d399" : "#f87171";

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={curve} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={shortDate}
            stroke="#475569"
            tick={{ fontSize: 12 }}
            minTickGap={40}
          />
          <YAxis
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => `$${money(v, 0)}`}
            stroke="#475569"
            tick={{ fontSize: 12 }}
            width={70}
          />
          <Tooltip
            contentStyle={{
              background: "#0f172a",
              border: "1px solid #334155",
              borderRadius: 8,
              color: "#e2e8f0",
            }}
            labelFormatter={(ts) => new Date(Number(ts)).toLocaleString()}
            formatter={(value) => [`$${money(Number(value))}`, "Account value"]}
          />
          <Area
            type="monotone"
            dataKey="equity"
            stroke={color}
            strokeWidth={2}
            fill="url(#equityFill)"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
