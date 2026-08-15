import { deepClone } from "./clone.js";
import { ITEM_ARRAY_KEYS, setItemArray } from "./types.js";
import type {
  ContextEnvelope,
  ContextItem,
  ItemArrayKey,
  SensitivityLevel,
  TrustLevel,
} from "./types.js";

/**
 * Best-effort restrictiveness ordering for `maxSensitivity` filtering only.
 * Not a claim about legal/regulatory equivalence between categories.
 */
export const SENSITIVITY_ORDER: SensitivityLevel[] = [
  "public",
  "internal",
  "confidential",
  "restricted",
  "personal",
  "secret",
];

export interface FilterContextOptions {
  /** Reference clock for validFrom/validUntil checks. Default: no expiry filtering. */
  asOf?: Date;
  /** Keep items whose scope intersects this set. Items with no scope always pass (open by default). */
  scope?: string[];
  /** Keep items whose tags intersect this set. Items with no tags always pass (open by default). */
  tags?: string[];
  /** Drop items whose `relevance` is defined and below this threshold. Items with no relevance always pass. */
  relevanceThreshold?: number;
  /** Keep only items whose trust.level is in this set. Items with no trust label always pass. */
  trustLevels?: TrustLevel[];
  /** Keep only items at or below this sensitivity level per SENSITIVITY_ORDER. Items with no sensitivity always pass — use redactContext for real enforcement. */
  maxSensitivity?: SensitivityLevel;
  arrayKeys?: readonly ItemArrayKey[];
  /** Extra custom predicate, applied last (AND). */
  predicate?: (item: ContextItem, key: ItemArrayKey) => boolean;
}

function intersects(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a || a.length === 0 || !b || b.length === 0) return false;
  const set = new Set(a);
  return b.some((value) => set.has(value));
}

function passesFilters(
  item: ContextItem,
  key: ItemArrayKey,
  options: FilterContextOptions,
): boolean {
  if (options.asOf) {
    const asOf = options.asOf.toISOString();
    if (item.validUntil && item.validUntil < asOf) return false;
    if (item.validFrom && item.validFrom > asOf) return false;
  }

  if (options.scope && options.scope.length > 0 && item.scope && item.scope.length > 0) {
    if (!intersects(options.scope, item.scope)) return false;
  }

  if (options.tags && options.tags.length > 0 && item.tags && item.tags.length > 0) {
    if (!intersects(options.tags, item.tags)) return false;
  }

  if (
    options.relevanceThreshold !== undefined &&
    item.relevance !== undefined &&
    item.relevance < options.relevanceThreshold
  ) {
    return false;
  }

  if (options.trustLevels && options.trustLevels.length > 0 && item.trust?.level) {
    if (!options.trustLevels.includes(item.trust.level)) return false;
  }

  if (options.maxSensitivity && item.sensitivity?.level) {
    const maxIndex = SENSITIVITY_ORDER.indexOf(options.maxSensitivity);
    const itemIndex = SENSITIVITY_ORDER.indexOf(item.sensitivity.level);
    if (itemIndex > maxIndex) return false;
  }

  if (options.predicate && !options.predicate(item, key)) return false;

  return true;
}

/**
 * Returns a new ContextEnvelope containing only items that pass every
 * supplied filter. All filters default to permissive ("item without the
 * relevant field passes") — see each option's doc comment. Does not mutate
 * its input.
 */
export function filterContext(
  context: ContextEnvelope,
  options: FilterContextOptions = {},
): ContextEnvelope {
  const keys = options.arrayKeys ?? ITEM_ARRAY_KEYS;
  const next = deepClone(context);
  for (const key of keys) {
    const arr = next[key];
    if (!arr) continue;
    const filtered = arr.filter((item) => passesFilters(item, key, options));
    setItemArray(next, key, filtered);
  }
  return next;
}
