import { deepClone } from "./clone.js";
import { ITEM_ARRAY_KEYS, setItemArray } from "./types.js";
import type {
  ContextEnvelope,
  ContextItem,
  HandlingRule,
  ItemArrayKey,
  SensitivityLevel,
} from "./types.js";

const DEFAULT_RULE_BY_LEVEL: Record<SensitivityLevel, HandlingRule["rule"]> = {
  public: "allow",
  internal: "allow",
  confidential: "redact",
  restricted: "exclude",
  personal: "redact",
  secret: "exclude",
};

export interface RedactContextOptions {
  /** Boundary name to match against `handling[].appliesTo` (e.g. "export", "compile", "log"). */
  boundary?: string;
  /** Used for the "summarize" handling rule. Falls back to a placeholder marker if omitted. */
  summarizer?: (content: string, item: ContextItem) => string;
  redactionMarker?: string;
  arrayKeys?: readonly ItemArrayKey[];
}

export interface RedactContextResult {
  context: ContextEnvelope;
  /** Items whose handling rule was "require-consent" — kept in the output, flagged, and listed here for the caller to gate on. */
  requiresConsent: ContextItem[];
  /** Items whose handling rule was "local-only" — kept in the output, flagged, and listed here; the caller MUST NOT forward these externally. */
  localOnly: ContextItem[];
  /** Items removed entirely ("exclude" rule, or no rule + a sensitivity level that defaults to exclude). */
  excluded: ContextItem[];
  redactedCount: number;
  summarizedCount: number;
}

function selectRule(
  item: ContextItem,
  boundary: string | undefined,
): HandlingRule["rule"] | undefined {
  const handling = item.sensitivity?.handling;
  if (handling && handling.length > 0) {
    if (boundary) {
      const scoped = handling.find((rule) => rule.appliesTo === boundary);
      if (scoped) return scoped.rule;
    }
    const universal = handling.find((rule) => !rule.appliesTo);
    if (universal) return universal.rule;
    return handling[0]?.rule;
  }
  if (item.sensitivity?.level) {
    return DEFAULT_RULE_BY_LEVEL[item.sensitivity.level];
  }
  return undefined;
}

function markExtension(item: ContextItem, rule: string): ContextItem {
  return {
    ...item,
    extensions: {
      ...(item.extensions ?? {}),
      "x-ulcs:redaction": { rule, appliedAt: new Date().toISOString() },
    },
  };
}

/**
 * Applies `sensitivity.handling` rules (see specification/v1/security.md#1)
 * to every item, per the boundary named in `options.boundary`. This is the
 * one place in `@ulcs/core` that actually *enforces* (rather than just
 * labels) security policy — but only the policy explicitly present in the
 * data. Does not mutate its input.
 */
export function redactContext(
  context: ContextEnvelope,
  options: RedactContextOptions = {},
): RedactContextResult {
  const keys = options.arrayKeys ?? ITEM_ARRAY_KEYS;
  const marker = options.redactionMarker ?? "[REDACTED]";
  const next = deepClone(context);

  const requiresConsent: ContextItem[] = [];
  const localOnly: ContextItem[] = [];
  const excluded: ContextItem[] = [];
  let redactedCount = 0;
  let summarizedCount = 0;

  for (const key of keys) {
    const arr = next[key];
    if (!arr) continue;

    const kept: ContextItem[] = [];
    for (const item of arr) {
      const rule = selectRule(item, options.boundary);
      switch (rule) {
        case "exclude":
          excluded.push(item);
          break;
        case "redact":
          kept.push(markExtension({ ...item, content: marker }, "redact"));
          redactedCount++;
          break;
        case "summarize": {
          const summarized = options.summarizer
            ? options.summarizer(item.content ?? "", item)
            : `[SUMMARIZED: ${(item.content ?? "").length} chars omitted]`;
          kept.push(markExtension({ ...item, content: summarized }, "summarize"));
          summarizedCount++;
          break;
        }
        case "require-consent":
          requiresConsent.push(item);
          kept.push(markExtension(item, "require-consent"));
          break;
        case "local-only":
          localOnly.push(item);
          kept.push(markExtension(item, "local-only"));
          break;
        case "allow":
        default:
          kept.push(item);
          break;
      }
    }
    setItemArray(next, key, kept);
  }

  return { context: next, requiresConsent, localOnly, excluded, redactedCount, summarizedCount };
}
