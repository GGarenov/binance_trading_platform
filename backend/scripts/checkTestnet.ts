// One-off connectivity check for Phase 12: prints testnet wallet balances and
// the BTCUSDT trading filters. Run with: npx tsx scripts/checkTestnet.ts
import "dotenv/config";
import { fetchSymbolFilters, fetchTestnetBalances } from "../src/services/binance/testnet";

async function main() {
  const balances = await fetchTestnetBalances();
  console.log("Testnet wallet (free balances):", balances);

  const filters = await fetchSymbolFilters("BTCUSDT");
  console.log("BTCUSDT filters:", filters);
}

main().catch((err) => {
  console.error("Testnet check failed:", err);
  process.exit(1);
});
