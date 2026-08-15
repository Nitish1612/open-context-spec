import { deepClone } from "./clone.js";
import { stableStringify, shortHash } from "./hash.js";
import { ITEM_ARRAY_KEYS, setItemArray } from "./types.js";
import type {
  ContextEnvelope,
  ContextItem,
  ConflictReport,
  ItemArrayKey,
  MergeResult,
} from "./types.js";

export interface MergeContextsOptions {
  /** Strategy for envelope-level singleton fields (objective, outputContract, security, tokenPolicy). Default "prefer-newer". */
  envelopeFieldStrategy?: "prefer-a" | "prefer-b" | "prefer-newer";
  /** Strategy for same-id/same-type items with different content where NOT both are "confirmed". Default "prefer-b". */
  itemStrategy?: "prefer-a" | "prefer-b";
}

/**
 * Fingerprint used to decide whether two same-id items represent the same
 * underlying claim. Deliberately excludes fields that legitimately vary
 * per-instance without changing meaning (priority, tags, relationships,
 * tokenEstimate) — only the substantive fields participate.
 */
function contentFingerprint(item: ContextItem): string {
  const {
    priority: _priority,
    tags: _tags,
    relationships: _relationships,
    tokenEstimate: _tokenEstimate,
    ...rest
  } = item;
  return stableStringify(rest);
}

function isContentEqual(a: ContextItem, b: ContextItem): boolean {
  return contentFingerprint(a) === contentFingerprint(b);
}

function unionArray<T>(a: T[] | undefined, b: T[] | undefined): T[] | undefined {
  if (!a && !b) return undefined;
  const combined = [...(a ?? []), ...(b ?? [])];
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of combined) {
    const key = stableStringify(value);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }
  return result;
}

function mergeIdenticalItem(a: ContextItem, b: ContextItem): ContextItem {
  const merged = deepClone(a);
  merged.tags = unionArray(a.tags, b.tags);
  merged.relationships = unionArray(a.relationships, b.relationships);
  merged.priority = Math.max(a.priority ?? 0, b.priority ?? 0);
  return merged;
}

function mergeArray(
  key: ItemArrayKey,
  a: ContextItem[],
  b: ContextItem[],
  options: Required<MergeContextsOptions>,
  conflicts: ConflictReport[],
): ContextItem[] {
  const byIdB = new Map(b.map((item) => [item.id, item]));
  const result: ContextItem[] = [];
  const handledIds = new Set<string>();

  for (const itemA of a) {
    const itemB = byIdB.get(itemA.id);
    if (!itemB) {
      result.push(itemA);
      handledIds.add(itemA.id);
      continue;
    }
    handledIds.add(itemA.id);

    if (itemA["@type"] !== itemB["@type"]) {
      const conflictId = `${itemB.id}#conflict:${shortHash(itemB)}`;
      const renamedB: ContextItem = { ...deepClone(itemB), id: conflictId };
      result.push(itemA, renamedB);
      conflicts.push({
        itemId: itemA.id,
        arrayKey: key,
        reason: "type-mismatch",
        itemFromA: itemA,
        itemFromB: itemB,
        resolution: "kept-both",
        keptId: conflictId,
      });
      continue;
    }

    if (isContentEqual(itemA, itemB)) {
      result.push(mergeIdenticalItem(itemA, itemB));
      continue;
    }

    const bothConfirmed = itemA.status === "confirmed" && itemB.status === "confirmed";
    if (bothConfirmed) {
      const conflictId = `${itemB.id}#conflict:${shortHash(itemB)}`;
      const renamedB: ContextItem = { ...deepClone(itemB), id: conflictId };
      result.push(itemA, renamedB);
      conflicts.push({
        itemId: itemA.id,
        arrayKey: key,
        reason: "content-mismatch",
        itemFromA: itemA,
        itemFromB: itemB,
        resolution: "kept-both",
        keptId: conflictId,
      });
    } else {
      result.push(options.itemStrategy === "prefer-a" ? itemA : itemB);
    }
  }

  for (const itemB of b) {
    if (!handledIds.has(itemB.id)) {
      result.push(itemB);
    }
  }

  return result;
}

function pickNewer<T>(
  a: T | undefined,
  b: T | undefined,
  strategy: "prefer-a" | "prefer-b" | "prefer-newer",
  createdAtA: string,
  createdAtB: string,
): T | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (strategy === "prefer-a") return a;
  if (strategy === "prefer-b") return b;
  return createdAtB >= createdAtA ? b : a;
}

/**
 * Deterministically merges two ContextEnvelopes. Item arrays are merged by
 * `id` (see specification/v1/interoperability.md#2-merge-semantics).
 * **Never** silently overwrites a `confirmed` item with a conflicting
 * `confirmed` item of the same id/type — both are retained and reported in
 * `conflicts`. Does not mutate either input.
 */
export function mergeContexts(
  a: ContextEnvelope,
  b: ContextEnvelope,
  options: MergeContextsOptions = {},
): MergeResult {
  const resolvedOptions: Required<MergeContextsOptions> = {
    envelopeFieldStrategy: options.envelopeFieldStrategy ?? "prefer-newer",
    itemStrategy: options.itemStrategy ?? "prefer-b",
  };

  const conflicts: ConflictReport[] = [];
  const merged = deepClone(a);

  for (const key of ITEM_ARRAY_KEYS) {
    const mergedArray = mergeArray(key, a[key] ?? [], b[key] ?? [], resolvedOptions, conflicts);
    setItemArray(merged, key, mergedArray);
  }

  merged.objective = pickNewer(
    a.objective,
    b.objective,
    resolvedOptions.envelopeFieldStrategy,
    a.createdAt,
    b.createdAt,
  );
  merged.outputContract = pickNewer(
    a.outputContract,
    b.outputContract,
    resolvedOptions.envelopeFieldStrategy,
    a.createdAt,
    b.createdAt,
  );
  merged.security = pickNewer(
    a.security,
    b.security,
    resolvedOptions.envelopeFieldStrategy,
    a.createdAt,
    b.createdAt,
  );
  merged.tokenPolicy = pickNewer(
    a.tokenPolicy,
    b.tokenPolicy,
    resolvedOptions.envelopeFieldStrategy,
    a.createdAt,
    b.createdAt,
  );
  merged.errors = [...(a.errors ?? []), ...(b.errors ?? [])];
  merged.extensions = { ...(a.extensions ?? {}), ...(b.extensions ?? {}) };

  return { merged, conflicts };
}
