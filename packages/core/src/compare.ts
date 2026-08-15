import { stableStringify } from "./hash.js";
import { ITEM_ARRAY_KEYS } from "./types.js";
import type { ContextEnvelope, ContextItem, ItemArrayKey } from "./types.js";

export interface ContextDiffEntry {
  arrayKey: ItemArrayKey;
  id: string;
  kind: "added" | "removed" | "changed";
  before?: ContextItem;
  after?: ContextItem;
}

export interface ContextDiff {
  entries: ContextDiffEntry[];
  envelopeFieldsChanged: string[];
}

const ENVELOPE_SCALAR_FIELDS = [
  "schemaVersion",
  "objective",
  "outputContract",
  "security",
  "tokenPolicy",
] as const;

/**
 * Deterministically diffs two ContextEnvelopes at the item level (by `id`
 * within each array) and at the envelope-scalar-field level. Entries are
 * sorted by array key, then id, for reproducible output — this is what
 * powers `ulcs diff`.
 */
export function compareContexts(before: ContextEnvelope, after: ContextEnvelope): ContextDiff {
  const entries: ContextDiffEntry[] = [];

  for (const key of ITEM_ARRAY_KEYS) {
    const beforeItems = before[key] ?? [];
    const afterItems = after[key] ?? [];
    const beforeById = new Map(beforeItems.map((item) => [item.id, item]));
    const afterById = new Map(afterItems.map((item) => [item.id, item]));
    const allIds = Array.from(new Set([...beforeById.keys(), ...afterById.keys()])).sort();

    for (const id of allIds) {
      const b = beforeById.get(id);
      const a = afterById.get(id);
      if (b && !a) {
        entries.push({ arrayKey: key, id, kind: "removed", before: b });
      } else if (!b && a) {
        entries.push({ arrayKey: key, id, kind: "added", after: a });
      } else if (b && a && stableStringify(b) !== stableStringify(a)) {
        entries.push({ arrayKey: key, id, kind: "changed", before: b, after: a });
      }
    }
  }

  entries.sort((x, y) =>
    x.arrayKey === y.arrayKey ? x.id.localeCompare(y.id) : x.arrayKey.localeCompare(y.arrayKey),
  );

  const envelopeFieldsChanged = ENVELOPE_SCALAR_FIELDS.filter(
    (field) => stableStringify(before[field]) !== stableStringify(after[field]),
  );

  return { entries, envelopeFieldsChanged };
}
