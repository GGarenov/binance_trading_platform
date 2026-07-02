import type { SimulatedTrade } from "@/lib/api";
import { dateTime, money, quantity } from "@/lib/format";

/**
 * Slippage of a live fill vs. the price the strategy intended, in percent.
 * Positive = the fill was worse for the trader (paid more / received less).
 */
function slippagePct(trade: SimulatedTrade): number | null {
  if (trade.intendedPrice === null) return null;
  const intended = Number(trade.intendedPrice);
  const filled = Number(trade.price);
  if (!(intended > 0)) return null;
  const raw = ((filled - intended) / intended) * 100;
  return trade.side === "buy" ? raw : -raw;
}

export function TradeLog({
  trades,
  showIntended = false,
}: {
  trades: SimulatedTrade[];
  /** Show intended price + slippage columns (live testnet/real sessions). */
  showIntended?: boolean;
}) {
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
            {showIntended ? <th className="px-4 py-3 text-right">Intended</th> : null}
            <th className="px-4 py-3 text-right">{showIntended ? "Filled" : "Price"}</th>
            {showIntended ? <th className="px-4 py-3 text-right">Slippage</th> : null}
            <th className="px-4 py-3 text-right">Quantity</th>
            <th className="px-4 py-3 text-right">Value</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => {
            const slip = showIntended ? slippagePct(trade) : null;
            return (
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
                {showIntended ? (
                  <td className="px-4 py-2.5 text-right font-mono text-slate-400">
                    {trade.intendedPrice !== null ? `$${money(trade.intendedPrice)}` : "—"}
                  </td>
                ) : null}
                <td className="px-4 py-2.5 text-right font-mono">${money(trade.price)}</td>
                {showIntended ? (
                  <td
                    className={
                      "px-4 py-2.5 text-right font-mono " +
                      (slip === null
                        ? "text-slate-500"
                        : slip > 0
                          ? "text-red-400"
                          : "text-emerald-400")
                    }
                  >
                    {slip !== null ? `${slip > 0 ? "+" : ""}${slip.toFixed(3)}%` : "—"}
                  </td>
                ) : null}
                <td className="px-4 py-2.5 text-right font-mono">{quantity(trade.quantity)}</td>
                <td className="px-4 py-2.5 text-right font-mono">${money(trade.quoteAmount)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
