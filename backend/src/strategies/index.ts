import type { StrategyDefinition } from "./types";
import { dcaStrategy } from "./dca";
import { gridStrategy } from "./grid";

// Maps the `slug` column of the strategies table to the code implementing it.
// Adding a third strategy later = one new file + one line here.
const registry = new Map<string, StrategyDefinition<never>>([
  [dcaStrategy.slug, dcaStrategy as StrategyDefinition<never>],
  [gridStrategy.slug, gridStrategy as StrategyDefinition<never>],
]);

export function getStrategyDefinition(slug: string): StrategyDefinition<never> | undefined {
  return registry.get(slug);
}
