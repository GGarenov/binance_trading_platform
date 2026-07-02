// Display helpers. They accept string | number because NUMERIC columns from
// PostgreSQL are serialized as strings in JSON.

export function money(value: string | number, digits = 2): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Signed money with a leading +/− so gains and losses read at a glance. */
export function signedMoney(value: string | number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : "−"}$${money(Math.abs(n))}`;
}

export function percent(value: string | number, digits = 2): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(digits)}%`;
}

/** Coin quantities: up to 8 decimals (Binance precision), trailing zeros trimmed. */
export function quantity(value: string | number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(8).replace(/\.?0+$/, "");
}

export function dateTime(value: string | number): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function shortDate(value: string | number): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
