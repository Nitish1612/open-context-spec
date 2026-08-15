import { deepClone } from "./clone.js";
import { ITEM_ARRAY_KEYS, setItemArray } from "./types.js";
import type { ContextEnvelope, ContextItem, TrustLabel } from "./types.js";

export interface NormalizeContextOptions {
  /** If true, sets `updatedAt` to `now()`. Default false (pure passthrough of timestamps otherwise). */
  touchUpdatedAt?: boolean;
  now?: () => Date;
}

const CONFIRMED_BY_DEFAULT = new Set(["Fact", "Decision", "Instruction", "Constraint"]);
const UNCONFIRMED_BY_DEFAULT = new Set(["Assumption"]);

/** The conservative default applied when an item has no trust label at all. */
export const DEFAULT_TRUST: TrustLabel = {
  level: "unknown",
  providesData: true,
  providesInstructions: false,
};

/** Callers only invoke this with an already-truthy array (see the `if (next.tags)` guards below). */
function normalizeStringSet(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function normalizeItem<T extends ContextItem>(item: T): T {
  const next = deepClone(item);

  if (next.tags) next.tags = normalizeStringSet(next.tags);
  if (next.scope) next.scope = normalizeStringSet(next.scope);

  if (next.status === undefined) {
    const type = next["@type"];
    if (CONFIRMED_BY_DEFAULT.has(type)) {
      next.status = "confirmed";
    } else if (UNCONFIRMED_BY_DEFAULT.has(type)) {
      next.status = "unconfirmed";
    }
  }

  if (next.trust === undefined) {
    next.trust = { ...DEFAULT_TRUST };
  } else {
    next.trust = {
      providesData: true,
      providesInstructions: false,
      ...next.trust,
    };
    if (next.trust.level === "untrusted") {
      next.trust.providesInstructions = false;
    }
  }

  return next;
}

/**
 * Canonicalizes a ContextEnvelope: fills missing item arrays with `[]`,
 * applies conservative per-item defaults (status, trust — see DEFAULT_TRUST),
 * and deduplicates/alphabetizes unordered string sets (`tags`, `scope`).
 *
 * Deliberately does NOT reorder item arrays — conversation history and
 * similar arrays are order-significant. Ordering for compilation is the
 * job of `rankContext` / `@ulcs/compiler`, not normalization. Does not
 * mutate its input.
 */
export function normalizeContext(
  context: ContextEnvelope,
  options: NormalizeContextOptions = {},
): ContextEnvelope {
  const next = deepClone(context);

  for (const key of ITEM_ARRAY_KEYS) {
    const arr = next[key];
    const normalized = (arr ?? []).map((item) => normalizeItem(item));
    setItemArray(next, key, normalized);
  }

  if (next.errors === undefined) next.errors = [];
  if (next.extensions === undefined) next.extensions = {};
  if (next.summary === undefined) next.summary = null;

  if (options.touchUpdatedAt) {
    const now = options.now ?? (() => new Date());
    next.updatedAt = now().toISOString();
  }

  return next;
}
