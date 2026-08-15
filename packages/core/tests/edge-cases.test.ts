import { describe, expect, it } from "vitest";
import {
  compareContexts,
  createContext,
  deepClone,
  deduplicateContext,
  exportContext,
  filterContext,
  mergeContexts,
  normalizeContext,
  rankContext,
  redactContext,
} from "../src/index.js";
import type { ContextEnvelope, Entity } from "../src/types.js";

describe("deepClone", () => {
  it("falls back to JSON round-tripping when structuredClone is unavailable", () => {
    const original = globalThis.structuredClone;
    // @ts-expect-error deliberately removing it to exercise the fallback path
    delete globalThis.structuredClone;
    try {
      const value = { a: 1, b: [1, 2, { c: 3 }] };
      const cloned = deepClone(value);
      expect(cloned).toEqual(value);
      expect(cloned).not.toBe(value);
    } finally {
      globalThis.structuredClone = original;
    }
  });
});

describe("filterContext extra options", () => {
  const ctx = createContext({
    facts: [
      { id: "urn:ulcs:fact:1", "@type": "Fact", content: "a", trust: { level: "trusted" } },
      { id: "urn:ulcs:fact:2", "@type": "Fact", content: "b", trust: { level: "untrusted" } },
      { id: "urn:ulcs:fact:3", "@type": "Fact", content: "c" },
    ],
  });

  it("filters by trustLevels, passing items with no trust label", () => {
    const filtered = filterContext(ctx, { trustLevels: ["trusted"] });
    expect(filtered.facts?.map((f) => f.id).sort()).toEqual(["urn:ulcs:fact:1", "urn:ulcs:fact:3"]);
  });

  it("applies a custom predicate as a final AND filter", () => {
    const filtered = filterContext(ctx, { predicate: (item) => item.content !== "b" });
    expect(filtered.facts?.map((f) => f.id).sort()).toEqual(["urn:ulcs:fact:1", "urn:ulcs:fact:3"]);
  });

  it("filters by scope intersection", () => {
    const scoped = createContext({
      facts: [
        { id: "urn:ulcs:fact:1", "@type": "Fact", content: "a", scope: ["current-task"] },
        { id: "urn:ulcs:fact:2", "@type": "Fact", content: "b", scope: ["global"] },
        { id: "urn:ulcs:fact:3", "@type": "Fact", content: "c" },
      ],
    });
    const filtered = filterContext(scoped, { scope: ["current-task"] });
    expect(filtered.facts?.map((f) => f.id).sort()).toEqual(["urn:ulcs:fact:1", "urn:ulcs:fact:3"]);
  });

  it("filters by tags intersection", () => {
    const tagged = createContext({
      facts: [
        { id: "urn:ulcs:fact:1", "@type": "Fact", content: "a", tags: ["billing"] },
        { id: "urn:ulcs:fact:2", "@type": "Fact", content: "b", tags: ["shipping"] },
      ],
    });
    const filtered = filterContext(tagged, { tags: ["billing"] });
    expect(filtered.facts?.map((f) => f.id)).toEqual(["urn:ulcs:fact:1"]);
  });

  it("drops items that are not yet valid (validFrom in the future)", () => {
    const notYetValid = createContext({
      facts: [
        {
          id: "urn:ulcs:fact:1",
          "@type": "Fact",
          content: "future",
          validFrom: "2030-01-01T00:00:00Z",
        },
      ],
    });
    const filtered = filterContext(notYetValid, { asOf: new Date("2026-08-15T00:00:00Z") });
    expect(filtered.facts).toHaveLength(0);
  });

  it("restricts filtering to the given arrayKeys, leaving other arrays untouched", () => {
    const withConvo = createContext({
      facts: [{ id: "urn:ulcs:fact:1", "@type": "Fact", content: "x", relevance: 0.01 }],
      conversation: [
        {
          id: "urn:ulcs:msg:1",
          "@type": "ConversationMessage",
          role: "user",
          content: "hi",
          relevance: 0.01,
        },
      ],
    });
    const filtered = filterContext(withConvo, { relevanceThreshold: 0.5, arrayKeys: ["facts"] });
    expect(filtered.facts).toHaveLength(0);
    expect(filtered.conversation).toHaveLength(1);
  });
});

describe("rankContext extra cases", () => {
  it("treats missing priority/relevance as 0 when comparing", () => {
    const ctx = createContext({
      facts: [
        { id: "urn:ulcs:fact:no-priority", "@type": "Fact", content: "x" },
        { id: "urn:ulcs:fact:has-priority", "@type": "Fact", content: "y", priority: 10 },
        { id: "urn:ulcs:fact:no-relevance", "@type": "Fact", content: "z", priority: 10 },
        {
          id: "urn:ulcs:fact:has-relevance",
          "@type": "Fact",
          content: "w",
          priority: 10,
          relevance: 0.5,
        },
      ],
    });
    const ranked = rankContext(ctx);
    // Among the three priority-10 items, the one with an explicit relevance
    // outranks the two whose relevance falls back to 0 via `?? 0`; the
    // priority-less item (falls back to priority 0) ranks last of all.
    expect(ranked.facts?.[0]?.id).toBe("urn:ulcs:fact:has-relevance");
    expect(ranked.facts?.[3]?.id).toBe("urn:ulcs:fact:no-priority");
  });

  it("returns 0 (stable) for two items with identical priority, relevance, and id", () => {
    const ctx = createContext({
      facts: [
        { id: "urn:ulcs:fact:dup", "@type": "Fact", content: "first", priority: 1, relevance: 0.5 },
        {
          id: "urn:ulcs:fact:dup",
          "@type": "Fact",
          content: "second",
          priority: 1,
          relevance: 0.5,
        },
      ],
    });
    expect(() => rankContext(ctx)).not.toThrow();
  });

  it("breaks ties by id in both directions across a 3-way tie", () => {
    const ctx = createContext({
      facts: [
        { id: "urn:ulcs:fact:c", "@type": "Fact", content: "c", priority: 5, relevance: 0.5 },
        { id: "urn:ulcs:fact:a", "@type": "Fact", content: "a", priority: 5, relevance: 0.5 },
        { id: "urn:ulcs:fact:b", "@type": "Fact", content: "b", priority: 5, relevance: 0.5 },
      ],
    });
    const ranked = rankContext(ctx);
    expect(ranked.facts?.map((f) => f.id)).toEqual([
      "urn:ulcs:fact:a",
      "urn:ulcs:fact:b",
      "urn:ulcs:fact:c",
    ]);
  });

  it("skips arrays that are absent on the input object", () => {
    const bare = {
      "@context": "https://ulcs.dev/context/v1",
      "@type": "ContextEnvelope",
      schemaVersion: "1.0.0",
      id: "urn:ulcs:context:bare",
      createdAt: "2026-08-15T00:00:00Z",
    } as ContextEnvelope;
    expect(() => rankContext(bare)).not.toThrow();
  });
});

describe("deduplicateContext extra cases", () => {
  it("deduplicates items with no content field (e.g. Entity) by @type + empty content", () => {
    const ctx = createContext({
      entities: [
        { id: "urn:ulcs:entity:1", "@type": "Entity", name: "A", entityType: "Product" },
        { id: "urn:ulcs:entity:2", "@type": "Entity", name: "B", entityType: "Product" },
      ] as Entity[],
    });
    // Entities have distinct `name`s but no `content`, so by the content-based
    // dedupe key they collapse to one — documenting that dedupe is
    // content-driven, not identity-driven, for types without `content`.
    const deduped = deduplicateContext(ctx, { arrayKeys: ["entities"] });
    expect(deduped.entities).toHaveLength(1);
  });

  it("honors a custom arrayKeys scope", () => {
    const ctx = createContext({
      facts: [
        { id: "urn:ulcs:fact:1", "@type": "Fact", content: "x" },
        { id: "urn:ulcs:fact:2", "@type": "Fact", content: "x" },
      ],
    });
    const deduped = deduplicateContext(ctx, { arrayKeys: ["preferences"] });
    expect(deduped.facts).toHaveLength(2);
  });

  it("treats missing priority as 0 when picking which duplicate's priority to keep", () => {
    const ctx = createContext({
      facts: [
        { id: "urn:ulcs:fact:1", "@type": "Fact", content: "same" },
        { id: "urn:ulcs:fact:2", "@type": "Fact", content: "same" },
      ],
    });
    const deduped = deduplicateContext(ctx);
    expect(deduped.facts).toHaveLength(1);
    expect(deduped.facts?.[0]?.priority).toBe(0);
  });

  it("skips arrays that are absent on the input object", () => {
    const bare = {
      "@context": "https://ulcs.dev/context/v1",
      "@type": "ContextEnvelope",
      schemaVersion: "1.0.0",
      id: "urn:ulcs:context:bare",
      createdAt: "2026-08-15T00:00:00Z",
    } as ContextEnvelope;
    expect(() => deduplicateContext(bare)).not.toThrow();
  });
});

describe("mergeContexts envelope-field strategies", () => {
  function ctxWithObjective(id: string, summary: string, createdAt: string) {
    return createContext({
      id,
      createdAt,
      objective: { id: "urn:ulcs:obj:1", "@type": "Objective", summary },
    });
  }

  it("prefer-a keeps a's objective even if b is newer", () => {
    const a = ctxWithObjective("urn:ulcs:context:a", "from A", "2026-01-01T00:00:00Z");
    const b = ctxWithObjective("urn:ulcs:context:b", "from B", "2026-06-01T00:00:00Z");
    const { merged } = mergeContexts(a, b, { envelopeFieldStrategy: "prefer-a" });
    expect(merged.objective?.summary).toBe("from A");
  });

  it("prefer-b keeps b's objective even if a is newer", () => {
    const a = ctxWithObjective("urn:ulcs:context:a", "from A", "2026-06-01T00:00:00Z");
    const b = ctxWithObjective("urn:ulcs:context:b", "from B", "2026-01-01T00:00:00Z");
    const { merged } = mergeContexts(a, b, { envelopeFieldStrategy: "prefer-b" });
    expect(merged.objective?.summary).toBe("from B");
  });

  it("prefer-newer (default) picks whichever envelope has the later createdAt", () => {
    const a = ctxWithObjective("urn:ulcs:context:a", "older", "2026-01-01T00:00:00Z");
    const b = ctxWithObjective("urn:ulcs:context:b", "newer", "2026-06-01T00:00:00Z");
    const { merged } = mergeContexts(a, b);
    expect(merged.objective?.summary).toBe("newer");
  });

  it("falls back to whichever side defines the field when only one does", () => {
    const aHasIt = createContext({
      id: "urn:ulcs:context:a",
      tokenPolicy: { maxContextTokens: 100 },
    });
    const bLacksIt = createContext({ id: "urn:ulcs:context:b" });
    expect(mergeContexts(aHasIt, bLacksIt).merged.tokenPolicy?.maxContextTokens).toBe(100);

    const aLacksIt = createContext({ id: "urn:ulcs:context:a" });
    const bHasIt = createContext({
      id: "urn:ulcs:context:b",
      tokenPolicy: { maxContextTokens: 200 },
    });
    expect(mergeContexts(aLacksIt, bHasIt).merged.tokenPolicy?.maxContextTokens).toBe(200);
  });

  it("treats missing item arrays on either side as empty rather than throwing", () => {
    const bareA = {
      "@type": "ContextEnvelope",
      createdAt: "2026-01-01T00:00:00Z",
    } as ContextEnvelope;
    const bareB = {
      "@type": "ContextEnvelope",
      createdAt: "2026-01-02T00:00:00Z",
      facts: [{ id: "urn:ulcs:fact:1", "@type": "Fact", content: "x" }],
    } as ContextEnvelope;
    const { merged } = mergeContexts(bareA, bareB);
    expect(merged.facts).toHaveLength(1);
  });
});

describe("normalizeContext touchUpdatedAt", () => {
  it("sets updatedAt when requested", () => {
    const ctx = createContext({});
    const normalized = normalizeContext(ctx, {
      touchUpdatedAt: true,
      now: () => new Date("2026-08-15T13:00:00Z"),
    });
    expect(normalized.updatedAt).toBe("2026-08-15T13:00:00.000Z");
  });

  it("uses the real clock when no now() is injected", () => {
    const ctx = createContext({});
    const before = Date.now();
    const normalized = normalizeContext(ctx, { touchUpdatedAt: true });
    expect(Date.parse(normalized.updatedAt as string)).toBeGreaterThanOrEqual(before);
  });
});

describe("normalizeContext on a raw object missing optional envelope arrays/fields", () => {
  it("fills in errors, extensions, and summary when entirely absent", () => {
    const bare = {
      "@context": "https://ulcs.dev/context/v1",
      "@type": "ContextEnvelope",
      schemaVersion: "1.0.0",
      id: "urn:ulcs:context:bare",
      createdAt: "2026-08-15T00:00:00Z",
    } as ContextEnvelope;
    const normalized = normalizeContext(bare);
    expect(normalized.errors).toEqual([]);
    expect(normalized.extensions).toEqual({});
    expect(normalized.summary).toBeNull();
    expect(normalized.facts).toEqual([]);
  });
});

describe("redactContext extra rule cases", () => {
  it("applies an explicit allow rule as a no-op", () => {
    const ctx = createContext({
      facts: [
        {
          id: "urn:ulcs:fact:1",
          "@type": "Fact",
          content: "visible",
          sensitivity: { level: "confidential", handling: [{ rule: "allow" }] },
        },
      ],
    });
    const { context } = redactContext(ctx);
    expect(context.facts?.[0]?.content).toBe("visible");
  });

  it("passes an item with no sensitivity label through unchanged", () => {
    const ctx = createContext({
      facts: [{ id: "urn:ulcs:fact:1", "@type": "Fact", content: "unclassified" }],
    });
    const { context, redactedCount, excluded } = redactContext(ctx);
    expect(context.facts?.[0]?.content).toBe("unclassified");
    expect(redactedCount).toBe(0);
    expect(excluded).toHaveLength(0);
  });

  it("falls back to a placeholder summary when no summarizer is supplied", () => {
    const ctx = createContext({
      facts: [
        {
          id: "urn:ulcs:fact:1",
          "@type": "Fact",
          content: "twenty characters!!",
          sensitivity: { level: "confidential", handling: [{ rule: "summarize" }] },
        },
      ],
    });
    const { context, summarizedCount } = redactContext(ctx);
    expect(context.facts?.[0]?.content).toBe("[SUMMARIZED: 19 chars omitted]");
    expect(summarizedCount).toBe(1);
  });

  it("falls back to handling[0] when no rule matches the requested boundary and none is universal", () => {
    const ctx = createContext({
      facts: [
        {
          id: "urn:ulcs:fact:1",
          "@type": "Fact",
          content: "x",
          sensitivity: {
            level: "confidential",
            handling: [{ rule: "redact", appliesTo: "export" }],
          },
        },
      ],
    });
    const { context } = redactContext(ctx, { boundary: "some-other-boundary" });
    expect(context.facts?.[0]?.content).toBe("[REDACTED]");
  });
});

describe("exportContext", () => {
  it("throws on an unknown format", () => {
    const ctx = createContext({});
    expect(() => exportContext(ctx, "yaml" as never)).toThrow(/Unknown export format/);
  });

  it("markdown export includes trust/status annotations and falls back to name for content-less items", () => {
    const ctx = createContext({
      facts: [
        {
          id: "urn:ulcs:fact:1",
          "@type": "Fact",
          content: "x",
          status: "confirmed",
          trust: { level: "trusted" },
        },
      ],
      entities: [
        { id: "urn:ulcs:entity:1", "@type": "Entity", name: "Widget", entityType: "Product" },
      ],
    });
    const md = exportContext(ctx, "markdown");
    expect(md).toContain("[confirmed]");
    expect(md).toContain("(trust: trusted)");
    expect(md).toContain("Widget");
  });
});

describe("compareContexts extra cases", () => {
  it("reports envelopeFieldsChanged for tokenPolicy and objective", () => {
    const before = createContext({ tokenPolicy: { maxContextTokens: 100 } });
    const after: ContextEnvelope = { ...before, tokenPolicy: { maxContextTokens: 200 } };
    const diff = compareContexts(before, after);
    expect(diff.envelopeFieldsChanged).toContain("tokenPolicy");
  });

  it("orders entries by arrayKey before id across multiple arrays", () => {
    const before = createContext({
      facts: [{ id: "urn:ulcs:fact:z", "@type": "Fact", content: "old" }],
    });
    const after = createContext({
      facts: [{ id: "urn:ulcs:fact:z", "@type": "Fact", content: "new" }],
      preferences: [{ id: "urn:ulcs:pref:a", "@type": "Preference", content: "new pref" }],
    });
    const diff = compareContexts(before, after);
    expect(diff.entries.map((e) => e.arrayKey)).toEqual(["facts", "preferences"]);
  });

  it("treats a missing item array on either side as empty rather than throwing", () => {
    const bareBefore = { "@type": "ContextEnvelope" } as ContextEnvelope;
    const bareAfter = {
      "@type": "ContextEnvelope",
      facts: [{ id: "urn:ulcs:fact:1", "@type": "Fact", content: "new" }],
    } as ContextEnvelope;
    const diff = compareContexts(bareBefore, bareAfter);
    expect(diff.entries).toEqual([
      { arrayKey: "facts", id: "urn:ulcs:fact:1", kind: "added", after: bareAfter.facts?.[0] },
    ]);
  });
});

describe("createContext with every optional envelope field set", () => {
  it("preserves updatedAt, outputContract, security, and tokenPolicy", () => {
    const ctx = createContext({
      updatedAt: "2026-08-15T13:00:00Z",
      outputContract: { format: "json" },
      security: { defaultTrust: "untrusted" },
      tokenPolicy: { maxContextTokens: 100 },
    });
    expect(ctx.updatedAt).toBe("2026-08-15T13:00:00Z");
    expect(ctx.outputContract?.format).toBe("json");
    expect(ctx.security?.defaultTrust).toBe("untrusted");
    expect(ctx.tokenPolicy?.maxContextTokens).toBe(100);
  });
});
