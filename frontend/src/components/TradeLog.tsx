import type { SimulatedTrade } from "@/lib/api";
import { dateTime, money, quantity } from "@/lib/format";

export function TradeLog({ trades }: { trades: SimulatedTrade[] }) {
  if (trades.length === 0) {
    return (
      <p className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-400">
        No trades yet. Trades appear here as soon as the strategy makes one.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-800 bg-slate-900/80 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-4 py-3">Time</th>
            <th className="px-4 py-3">Side</th>
            <th className="px-4 py-3 text-right">Price</th>
            <th className="px-4 py-3 text-right">Quantity</th>
            <th className="px-4 py-3 text-right">Value</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => (
            <tr key={trade.id} className="border-b border-slate-800/60 last:border-0">
              <td className="px-4 py-2.5 text-slate-400">{dateTime(trade.executedAt)}</td>
              <td className="px-4 py-2.5">
                <span
                  className={
                    trade.side === "buy"
                      ? "font-medium text-emerald-400"
                      : "font-medium text-red-400"
                  }
                >
                  {trade.side.toUpperCase()}
                </span>
              </td>
              <td className="px-4 py-2.5 text-right font-mono">${money(trade.price)}</td>
              <td className="px-4 py-2.5 text-right font-mono">{quantity(trade.quantity)}</td>
              <td className="px-4 py-2.5 text-right font-mono">${money(trade.quoteAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
