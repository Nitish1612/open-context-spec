import { describe, expect, it } from "vitest";
import { createContext, deduplicateContext, filterContext, rankContext } from "../src/index.js";

describe("deduplicateContext", () => {
  it("keeps the highest-priority duplicate and preserves first-appearance order", () => {
    const ctx = createContext({
      facts: [
        { id: "urn:ulcs:fact:1", "@type": "Fact", content: "same", priority: 10 },
        { id: "urn:ulcs:fact:2", "@type": "Fact", content: "different", priority: 5 },
        { id: "urn:ulcs:fact:3", "@type": "Fact", content: "same", priority: 90 },
      ],
    });
    const deduped = deduplicateContext(ctx);
    expect(deduped.facts).toHaveLength(2);
    expect(deduped.facts?.[0]?.id).toBe("urn:ulcs:fact:1");
    expect(deduped.facts?.[0]?.priority).toBe(90);
    expect(deduped.facts?.[1]?.id).toBe("urn:ulcs:fact:2");
  });
});

describe("filterContext", () => {
  it("drops expired items as of a given clock", () => {
    const ctx = createContext({
      facts: [
        {
          id: "urn:ulcs:fact:1",
          "@type": "Fact",
          content: "fresh",
          validUntil: "2027-01-01T00:00:00Z",
        },
        {
          id: "urn:ulcs:fact:2",
          "@type": "Fact",
          content: "stale",
          validUntil: "2020-01-01T00:00:00Z",
        },
      ],
    });
    const filtered = filterContext(ctx, { asOf: new Date("2026-08-15T00:00:00Z") });
    expect(filtered.facts?.map((f) => f.id)).toEqual(["urn:ulcs:fact:1"]);
  });

  it("drops items below a relevance threshold, passing items with no relevance set", () => {
    const ctx = createContext({
      facts: [
        { id: "urn:ulcs:fact:1", "@type": "Fact", content: "a", relevance: 0.9 },
        { id: "urn:ulcs:fact:2", "@type": "Fact", content: "b", relevance: 0.1 },
        { id: "urn:ulcs:fact:3", "@type": "Fact", content: "c" },
      ],
    });
    const filtered = filterContext(ctx, { relevanceThreshold: 0.5 });
    expect(filtered.facts?.map((f) => f.id)).toEqual(["urn:ulcs:fact:1", "urn:ulcs:fact:3"]);
  });

  it("filters by maxSensitivity, passing items with no sensitivity set", () => {
    const ctx = createContext({
      facts: [
        {
          id: "urn:ulcs:fact:1",
          "@type": "Fact",
          content: "public",
          sensitivity: { level: "public" },
        },
        {
          id: "urn:ulcs:fact:2",
          "@type": "Fact",
          content: "secret",
          sensitivity: { level: "secret" },
        },
        { id: "urn:ulcs:fact:3", "@type": "Fact", content: "unlabeled" },
      ],
    });
    const filtered = filterContext(ctx, { maxSensitivity: "internal" });
    expect(filtered.facts?.map((f) => f.id).sort()).toEqual(["urn:ulcs:fact:1", "urn:ulcs:fact:3"]);
  });
});

describe("rankContext", () => {
  it("sorts by priority desc, then relevance desc, then id asc", () => {
    const ctx = createContext({
      facts: [
        { id: "urn:ulcs:fact:b", "@type": "Fact", content: "b", priority: 50, relevance: 0.5 },
        { id: "urn:ulcs:fact:a", "@type": "Fact", content: "a", priority: 50, relevance: 0.9 },
        { id: "urn:ulcs:fact:c", "@type": "Fact", content: "c", priority: 90 },
      ],
    });
    const ranked = rankContext(ctx);
    expect(ranked.facts?.map((f) => f.id)).toEqual([
      "urn:ulcs:fact:c",
      "urn:ulcs:fact:a",
      "urn:ulcs:fact:b",
    ]);
  });

  it("does not reorder conversation by default", () => {
    const ctx = createContext({
      conversation: [
        {
          id: "urn:ulcs:msg:2",
          "@type": "ConversationMessage",
          role: "user",
          content: "second",
          priority: 1,
        },
        {
          id: "urn:ulcs:msg:1",
          "@type": "ConversationMessage",
          role: "user",
          content: "first",
          priority: 99,
        },
      ],
    });
    const ranked = rankContext(ctx);
    expect(ranked.conversation?.map((m) => m.id)).toEqual(["urn:ulcs:msg:2", "urn:ulcs:msg:1"]);
  });
});
