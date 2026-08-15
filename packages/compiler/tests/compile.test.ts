import { createContext } from "@ulcs/core";
import { describe, expect, it } from "vitest";
import { compileContext } from "../src/index.js";

describe("compileContext", () => {
  it("is deterministic: same input yields identical output", () => {
    const ctx = createContext({
      facts: [
        { id: "urn:ulcs:fact:1", "@type": "Fact", content: "A", priority: 50 },
        { id: "urn:ulcs:fact:2", "@type": "Fact", content: "B", priority: 80 },
      ],
    });
    const asOf = new Date("2026-08-15T12:00:00Z");
    const a = compileContext(ctx, { asOf });
    const b = compileContext(ctx, { asOf });
    expect(a).toEqual(b);
  });

  it("orders items by priority within a section", () => {
    const ctx = createContext({
      facts: [
        { id: "urn:ulcs:fact:low", "@type": "Fact", content: "low", priority: 10 },
        { id: "urn:ulcs:fact:high", "@type": "Fact", content: "high", priority: 90 },
      ],
    });
    const compiled = compileContext(ctx);
    const factsSection = compiled.sections.find((s) => s.key === "facts")!;
    expect(factsSection.items.map((i) => i.item.id)).toEqual([
      "urn:ulcs:fact:high",
      "urn:ulcs:fact:low",
    ]);
  });

  it("drops items whose validUntil has passed as of the compile clock", () => {
    const ctx = createContext({
      facts: [
        {
          id: "urn:ulcs:fact:1",
          "@type": "Fact",
          content: "stale",
          validUntil: "2020-01-01T00:00:00Z",
        },
        { id: "urn:ulcs:fact:2", "@type": "Fact", content: "fresh" },
      ],
    });
    const compiled = compileContext(ctx, { asOf: new Date("2026-08-15T00:00:00Z") });
    const factsSection = compiled.sections.find((s) => s.key === "facts")!;
    expect(factsSection.items.map((i) => i.item.id)).toEqual(["urn:ulcs:fact:2"]);
    expect(compiled.droppedItems).toContainEqual({
      arrayKey: "facts",
      id: "urn:ulcs:fact:1",
      reason: "expired",
    });
  });

  it("always includes requiredItemIds even when the budget is tight, and records a fatal error if they overflow it", () => {
    const ctx = createContext({
      tokenPolicy: { maxContextTokens: 5, requiredItemIds: ["urn:ulcs:fact:big"] },
      facts: [{ id: "urn:ulcs:fact:big", "@type": "Fact", content: "x".repeat(400) }],
    });
    const compiled = compileContext(ctx);
    const factsSection = compiled.sections.find((s) => s.key === "facts")!;
    expect(factsSection.items).toHaveLength(1);
    expect(factsSection.items[0]?.required).toBe(true);
    expect(compiled.errors.some((e) => e.code === "REQUIRED_ITEM_OVER_BUDGET")).toBe(true);
  });

  it("truncates an item that doesn't fit when allowTruncation is true (default)", () => {
    const ctx = createContext({
      tokenPolicy: { maxContextTokens: 20, reservedOutputTokens: 0 },
      facts: [{ id: "urn:ulcs:fact:1", "@type": "Fact", content: "x".repeat(200) }],
    });
    const compiled = compileContext(ctx);
    const factsSection = compiled.sections.find((s) => s.key === "facts")!;
    expect(factsSection.items).toHaveLength(1);
    expect(factsSection.items[0]?.truncated).toBe(true);
    expect(factsSection.items[0]?.item.content?.endsWith("…")).toBe(true);
  });

  it("drops an over-budget item entirely when truncation is disallowed", () => {
    const ctx = createContext({
      tokenPolicy: { maxContextTokens: 5, reservedOutputTokens: 0, allowTruncation: false },
      facts: [{ id: "urn:ulcs:fact:1", "@type": "Fact", content: "x".repeat(200) }],
    });
    const compiled = compileContext(ctx);
    const factsSection = compiled.sections.find((s) => s.key === "facts")!;
    expect(factsSection.items).toHaveLength(0);
    expect(compiled.droppedItems).toContainEqual({
      arrayKey: "facts",
      id: "urn:ulcs:fact:1",
      reason: "over-budget",
    });
  });

  it("uses a custom summarizer when allowSummarization is true and the item doesn't fit", () => {
    const ctx = createContext({
      tokenPolicy: {
        maxContextTokens: 10,
        reservedOutputTokens: 0,
        allowTruncation: false,
        allowSummarization: true,
      },
      facts: [{ id: "urn:ulcs:fact:1", "@type": "Fact", content: "x".repeat(200) }],
    });
    const compiled = compileContext(ctx, { summarizer: () => "short" });
    const factsSection = compiled.sections.find((s) => s.key === "facts")!;
    expect(factsSection.items).toHaveLength(1);
    expect(factsSection.items[0]?.summarized).toBe(true);
    expect(factsSection.items[0]?.item.content).toBe("short");
  });

  it("respects per-section budgets independently of the global budget", () => {
    const ctx = createContext({
      tokenPolicy: { sectionBudgets: { facts: 5 } },
      facts: [{ id: "urn:ulcs:fact:1", "@type": "Fact", content: "x".repeat(200) }],
      preferences: [{ id: "urn:ulcs:pref:1", "@type": "Preference", content: "y".repeat(20) }],
    });
    const compiled = compileContext(ctx);
    const factsSection = compiled.sections.find((s) => s.key === "facts")!;
    const prefsSection = compiled.sections.find((s) => s.key === "preferences")!;
    expect(factsSection.items[0]?.truncated).toBe(true);
    expect(prefsSection.items[0]?.truncated).toBe(false);
  });

  it("removes duplicate items and records the reason", () => {
    const ctx = createContext({
      facts: [
        { id: "urn:ulcs:fact:1", "@type": "Fact", content: "same", priority: 10 },
        { id: "urn:ulcs:fact:2", "@type": "Fact", content: "same", priority: 5 },
      ],
    });
    const compiled = compileContext(ctx);
    const factsSection = compiled.sections.find((s) => s.key === "facts")!;
    expect(factsSection.items).toHaveLength(1);
    expect(compiled.droppedItems.some((d) => d.reason === "duplicate")).toBe(true);
  });

  it("never reorders conversation history", () => {
    const ctx = createContext({
      conversation: [
        {
          id: "urn:ulcs:msg:1",
          "@type": "ConversationMessage",
          role: "user",
          content: "first",
          priority: 1,
        },
        {
          id: "urn:ulcs:msg:2",
          "@type": "ConversationMessage",
          role: "assistant",
          content: "second",
          priority: 99,
        },
      ],
    });
    const compiled = compileContext(ctx);
    const conversationSection = compiled.sections.find((s) => s.key === "conversation")!;
    expect(conversationSection.items.map((i) => i.item.id)).toEqual([
      "urn:ulcs:msg:1",
      "urn:ulcs:msg:2",
    ]);
  });

  it("counts the objective's tokens toward the total when present", () => {
    const withObjective = createContext({
      objective: { id: "urn:ulcs:obj:1", "@type": "Objective", summary: "Resolve the ticket." },
    });
    const withoutObjective = createContext({});
    const compiledWith = compileContext(withObjective);
    const compiledWithout = compileContext(withoutObjective);
    expect(compiledWith.objective?.summary).toBe("Resolve the ticket.");
    expect(compiledWith.totalEstimatedTokens).toBeGreaterThan(compiledWithout.totalEstimatedTokens);
  });

  it("emits an UNBOUNDED_COMPILATION warning when no maxContextTokens is set", () => {
    const ctx = createContext({
      facts: [{ id: "urn:ulcs:fact:1", "@type": "Fact", content: "x" }],
    });
    const compiled = compileContext(ctx);
    expect(compiled.warnings.some((w) => w.code === "UNBOUNDED_COMPILATION")).toBe(true);
  });
});
