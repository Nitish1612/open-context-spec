import { ITEM_ARRAY_KEYS, deduplicateContext, normalizeContext, rankContext } from "@ulcs/core";
import type {
  ContextEnvelope,
  ContextItem,
  ErrorItem,
  ItemArrayKey,
  TokenPolicy,
} from "@ulcs/core";
import {
  approxChar4Tokenizer,
  getItemText,
  getObjectiveText,
  type Tokenizer,
} from "./tokenizer.js";
import { truncateToTokens } from "./truncate.js";
import type {
  CompiledContext,
  CompiledItem,
  CompiledSection,
  DropReason,
  DroppedItemRecord,
} from "./types.js";

export const SECTION_ORDER: ItemArrayKey[] = [
  "instructions",
  "actors",
  "constraints",
  "facts",
  "assumptions",
  "decisions",
  "preferences",
  "entities",
  "relationships",
  "memory",
  "resources",
  "conversation",
  "tools",
  "toolResults",
  "questions",
];

const SECTION_TITLES: Record<ItemArrayKey, string> = {
  actors: "Actors",
  instructions: "Instructions",
  facts: "Facts",
  assumptions: "Assumptions",
  constraints: "Constraints",
  preferences: "Preferences",
  decisions: "Decisions",
  questions: "Questions",
  conversation: "Conversation",
  resources: "Resources",
  entities: "Entities",
  relationships: "Relationships",
  memory: "Memory",
  tools: "Tools",
  toolResults: "Tool Results",
};

export interface CompileContextOptions {
  asOf?: Date;
  tokenizer?: Tokenizer;
  tokenizerName?: string;
  summarizer?: (text: string, item: ContextItem) => string;
  tokenPolicyOverrides?: Partial<TokenPolicy>;
}

function isExpired(item: ContextItem, asOfIso: string): boolean {
  if (item.validUntil && item.validUntil < asOfIso) return true;
  if (item.validFrom && item.validFrom > asOfIso) return true;
  return false;
}

function isBelowRelevance(item: ContextItem, threshold: number | undefined): boolean {
  return threshold !== undefined && item.relevance !== undefined && item.relevance < threshold;
}

function isSensitivityExcluded(item: ContextItem): boolean {
  const universalRule = item.sensitivity?.handling?.find((rule) => !rule.appliesTo);
  return universalRule?.rule === "exclude" || universalRule?.rule === "local-only";
}

interface FilterOutcome {
  kept: ContextEnvelope;
  dropped: DroppedItemRecord[];
}

function filterWithReasons(
  context: ContextEnvelope,
  asOfIso: string,
  relevanceThreshold: number | undefined,
): FilterOutcome {
  const kept = structuredClone(context);
  const dropped: DroppedItemRecord[] = [];

  for (const key of ITEM_ARRAY_KEYS) {
    const arr = kept[key] ?? [];
    const survivors: ContextItem[] = [];
    for (const item of arr) {
      let reason: DropReason | undefined;
      if (isExpired(item, asOfIso)) reason = "expired";
      else if (isBelowRelevance(item, relevanceThreshold)) reason = "below-relevance-threshold";
      else if (isSensitivityExcluded(item)) reason = "excluded-by-sensitivity";

      if (reason) {
        dropped.push({ arrayKey: key, id: item.id, reason });
      } else {
        survivors.push(item);
      }
    }
    (kept as unknown as Record<ItemArrayKey, ContextItem[]>)[key] = survivors;
  }

  return { kept, dropped };
}

function dedupeWithReasons(context: ContextEnvelope): FilterOutcome {
  const deduped = deduplicateContext(context);
  const dropped: DroppedItemRecord[] = [];
  for (const key of ITEM_ARRAY_KEYS) {
    const beforeIds = new Set((context[key] ?? []).map((item) => item.id));
    const afterIds = new Set((deduped[key] ?? []).map((item) => item.id));
    for (const id of beforeIds) {
      if (!afterIds.has(id)) dropped.push({ arrayKey: key, id, reason: "duplicate" });
    }
  }
  return { kept: deduped, dropped };
}

/**
 * Deterministically selects and orders context items under an approximate
 * token budget, then returns a provider-neutral CompiledContext.
 * See specification/v1/token-policy.md#4-deterministic-compilation-algorithm.
 *
 * This does NOT perform full sensitivity redaction (no boundary-scoped
 * "redact"/"summarize" content rewriting, no require-consent gating) — call
 * `redactContext` from `@ulcs/core` first if your context may contain
 * restricted/personal/secret items. See specification/v1/security.md.
 */
export function compileContext(
  context: ContextEnvelope,
  options: CompileContextOptions = {},
): CompiledContext {
  const asOf = options.asOf ?? new Date();
  const asOfIso = asOf.toISOString();
  const tokenizer = options.tokenizer ?? approxChar4Tokenizer;
  const tokenizerName = options.tokenizer ? (options.tokenizerName ?? "custom") : "approx-char4";

  const policy: TokenPolicy = {
    deduplicate: true,
    allowTruncation: true,
    allowSummarization: false,
    ...context.tokenPolicy,
    ...options.tokenPolicyOverrides,
  };

  const normalized = normalizeContext(context);
  const { kept: filtered, dropped: filterDropped } = filterWithReasons(
    normalized,
    asOfIso,
    policy.relevanceThreshold,
  );

  let working = filtered;
  let dedupeDropped: DroppedItemRecord[] = [];
  if (policy.deduplicate !== false) {
    const result = dedupeWithReasons(filtered);
    working = result.kept;
    dedupeDropped = result.dropped;
  }

  working = rankContext(working);

  const requiredIds = new Set(policy.requiredItemIds ?? []);
  const errors: ErrorItem[] = [];
  const warnings: ErrorItem[] = [];
  const droppedItems: DroppedItemRecord[] = [...filterDropped, ...dedupeDropped];

  const effectiveInputBudget =
    policy.maxContextTokens !== undefined
      ? Math.max(0, policy.maxContextTokens - (policy.reservedOutputTokens ?? 0))
      : undefined;
  let remainingGlobal = effectiveInputBudget ?? Number.POSITIVE_INFINITY;

  if (policy.maxContextTokens === undefined) {
    warnings.push({
      "@type": "Error",
      code: "UNBOUNDED_COMPILATION",
      message:
        "No tokenPolicy.maxContextTokens was supplied; compiling without a global token budget.",
      severity: "warning",
    });
  }

  let totalEstimatedTokens = 0;
  const objective = working.objective;
  if (objective) {
    const text = getObjectiveText(objective);
    const tokens = tokenizer(text);
    totalEstimatedTokens += tokens;
    remainingGlobal -= tokens;
  }

  const sections: CompiledSection[] = [];

  for (const key of SECTION_ORDER) {
    const arr = working[key] ?? [];
    const required = arr.filter((item) => requiredIds.has(item.id));
    const rest = arr.filter((item) => !requiredIds.has(item.id));

    let remainingSection = policy.sectionBudgets?.[key] ?? Number.POSITIVE_INFINITY;
    const compiledItems: CompiledItem[] = [];
    let sectionTokens = 0;

    for (const item of required) {
      const tokens = tokenizer(getItemText(item));
      compiledItems.push({
        item,
        estimatedTokens: tokens,
        required: true,
        truncated: false,
        summarized: false,
      });
      sectionTokens += tokens;
      remainingSection -= tokens;
      remainingGlobal -= tokens;
      if (remainingSection < 0 || remainingGlobal < 0) {
        errors.push({
          "@type": "Error",
          code: "REQUIRED_ITEM_OVER_BUDGET",
          message: `Required item exceeded the available token budget but was included anyway.`,
          itemId: item.id,
          severity: "fatal",
        });
      }
    }

    for (const item of rest) {
      const text = getItemText(item);
      const tokens = tokenizer(text);
      const fits = tokens <= remainingSection && tokens <= remainingGlobal;

      if (fits) {
        compiledItems.push({
          item,
          estimatedTokens: tokens,
          required: false,
          truncated: false,
          summarized: false,
        });
        sectionTokens += tokens;
        remainingSection -= tokens;
        remainingGlobal -= tokens;
        continue;
      }

      const maxAllowed = Math.max(0, Math.min(remainingSection, remainingGlobal));

      if (policy.allowTruncation && maxAllowed > 0) {
        const truncatedText = truncateToTokens(text, maxAllowed, tokenizer);
        const truncatedTokens = tokenizer(truncatedText);
        if (truncatedText.length > 0 && truncatedTokens <= maxAllowed) {
          compiledItems.push({
            item: {
              ...item,
              content: truncatedText,
              extensions: { ...(item.extensions ?? {}), "x-ulcs:truncated": true },
            },
            estimatedTokens: truncatedTokens,
            required: false,
            truncated: true,
            summarized: false,
          });
          sectionTokens += truncatedTokens;
          remainingSection -= truncatedTokens;
          remainingGlobal -= truncatedTokens;
          continue;
        }
      }

      if (policy.allowSummarization && options.summarizer) {
        const summarizedText = options.summarizer(text, item);
        const summarizedTokens = tokenizer(summarizedText);
        if (summarizedTokens <= remainingSection && summarizedTokens <= remainingGlobal) {
          compiledItems.push({
            item: {
              ...item,
              content: summarizedText,
              extensions: { ...(item.extensions ?? {}), "x-ulcs:summarized": true },
            },
            estimatedTokens: summarizedTokens,
            required: false,
            truncated: false,
            summarized: true,
          });
          sectionTokens += summarizedTokens;
          remainingSection -= summarizedTokens;
          remainingGlobal -= summarizedTokens;
          continue;
        }
      }

      droppedItems.push({ arrayKey: key, id: item.id, reason: "over-budget" });
    }

    sections.push({
      key,
      title: SECTION_TITLES[key],
      items: compiledItems,
      estimatedTokens: sectionTokens,
    });
    totalEstimatedTokens += sectionTokens;
  }

  return {
    envelopeId: context.id,
    schemaVersion: context.schemaVersion,
    compiledAt: asOfIso,
    objective,
    sections,
    outputContract: context.outputContract,
    security: context.security,
    tokenBudget: {
      maxContextTokens: policy.maxContextTokens,
      reservedOutputTokens: policy.reservedOutputTokens,
      effectiveInputBudget,
      tokenizerName,
    },
    totalEstimatedTokens,
    droppedItems,
    warnings,
    errors,
  };
}
