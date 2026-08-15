import { deepClone } from "./clone.js";
import { shortHash } from "./hash.js";
import { ITEM_ARRAY_KEYS, setItemArray } from "./types.js";
import type { ContextEnvelope, ContextItem } from "./types.js";

export interface DeduplicateContextOptions {
  /** Which envelope arrays to deduplicate. Default: all item arrays. */
  arrayKeys?: readonly (typeof ITEM_ARRAY_KEYS)[number][];
}

function dedupeKey(item: ContextItem): string {
  return `${item["@type"]}::${shortHash(item.content ?? "")}`;
}

/**
 * Duplicates are folded into the first-occurring item's identity (its `id`
 * is preserved, so anything that references that id keeps working) while
 * adopting the highest `priority` seen and the union of `tags` across
 * duplicates.
 */
function dedupeArray(items: ContextItem[]): ContextItem[] {
  const firstByKey = new Map<string, ContextItem>();
  const order: string[] = [];

  for (const item of items) {
    const key = dedupeKey(item);
    const existing = firstByKey.get(key);
    if (!existing) {
      firstByKey.set(key, item);
      order.push(key);
      continue;
    }
    const mergedTags = Array.from(new Set([...(existing.tags ?? []), ...(item.tags ?? [])])).sort();
    firstByKey.set(key, {
      ...existing,
      priority: Math.max(existing.priority ?? 0, item.priority ?? 0),
      ...(mergedTags.length > 0 ? { tags: mergedTags } : {}),
    });
  }

  return order.map((key) => firstByKey.get(key)!);
}

/**
 * Removes duplicate items (same `@type` + `content`) within each item
 * array, keeping the highest-`priority` copy and preserving the relative
 * order of first appearance. Deterministic; does not mutate its input.
 */
export function deduplicateContext(
  context: ContextEnvelope,
  options: DeduplicateContextOptions = {},
): ContextEnvelope {
  const keys = options.arrayKeys ?? ITEM_ARRAY_KEYS;
  const next = deepClone(context);
  for (const key of keys) {
    const arr = next[key];
    if (!arr) continue;
    setItemArray(next, key, dedupeArray(arr));
  }
  return next;
}
