import type { StrategyDefinition } from "./types";
import { dcaStrategy } from "./dca";
import { gridStrategy } from "./grid";
import { maCrossoverStrategy } from "./maCrossover";
import { rsiReversionStrategy } from "./rsiReversion";

// Maps the `slug` column of the strategies table to the code implementing it.
// Adding a strategy = one new file + one line here (+ a seed row).
// The registry is heterogeneous — each entry has different params — so the
// param type is erased here; paramsSchema.parse() restores type safety at use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registry = new Map<string, StrategyDefinition<any>>([
  [dcaStrategy.slug, dcaStrategy],
  [gridStrategy.slug, gridStrategy],
  [maCrossoverStrategy.slug, maCrossoverStrategy],
  [rsiReversionStrategy.slug, rsiReversionStrategy],
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getStrategyDefinition(slug: string): StrategyDefinition<any> | undefined {
  return registry.get(slug);
}
