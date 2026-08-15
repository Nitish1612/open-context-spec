import { deepClone } from "./clone.js";
import { ITEM_ARRAY_KEYS, setItemArray } from "./types.js";
import type { ContextEnvelope, ContextItem, ItemArrayKey } from "./types.js";

const DEFAULT_RANKED_KEYS = ITEM_ARRAY_KEYS.filter((key) => key !== "conversation");

export interface RankContextOptions {
  /**
   * Which arrays to sort. Defaults to every item array except
   * `conversation`, since conversation history is chronologically
   * meaningful and reordering it changes its meaning. Pass `conversation`
   * explicitly if you really want it re-ranked.
   */
  arrayKeys?: readonly ItemArrayKey[];
}

function compareItems(a: ContextItem, b: ContextItem): number {
  const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0);
  if (priorityDiff !== 0) return priorityDiff;
  const relevanceDiff = (b.relevance ?? 0) - (a.relevance ?? 0);
  if (relevanceDiff !== 0) return relevanceDiff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Sorts items within each targeted array by `priority` (desc), then
 * `relevance` (desc), then `id` (asc) as a stable, deterministic tiebreak.
 * Does not mutate its input.
 */
export function rankContext(
  context: ContextEnvelope,
  options: RankContextOptions = {},
): ContextEnvelope {
  const keys = options.arrayKeys ?? DEFAULT_RANKED_KEYS;
  const next = deepClone(context);
  for (const key of keys) {
    const arr = next[key];
    if (!arr) continue;
    const sorted = [...arr].sort(compareItems);
    setItemArray(next, key, sorted);
  }
  return next;
}
