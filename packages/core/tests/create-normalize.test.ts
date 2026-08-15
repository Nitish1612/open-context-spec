import { describe, expect, it } from "vitest";
import {
  createContext,
  normalizeContext,
  ULCS_JSONLD_CONTEXT,
  ULCS_SCHEMA_VERSION,
} from "../src/index.js";

describe("createContext", () => {
  it("fills required defaults", () => {
    const ctx = createContext({}, { now: () => new Date("2026-08-15T12:00:00Z") });
    expect(ctx["@context"]).toBe(ULCS_JSONLD_CONTEXT);
    expect(ctx["@type"]).toBe("ContextEnvelope");
    expect(ctx.schemaVersion).toBe(ULCS_SCHEMA_VERSION);
    expect(ctx.id).toMatch(/^urn:ulcs:context:/);
    expect(ctx.createdAt).toBe("2026-08-15T12:00:00.000Z");
    expect(ctx.facts).toEqual([]);
    expect(ctx.instructions).toEqual([]);
    expect(ctx.errors).toEqual([]);
    expect(ctx.summary).toBeNull();
  });

  it("preserves explicit fields and does not mutate input", () => {
    const input = {
      id: "urn:ulcs:context:example",
      facts: [{ id: "urn:ulcs:fact:1", "@type": "Fact" as const, content: "hi" }],
    };
    const ctx = createContext(input);
    expect(ctx.id).toBe("urn:ulcs:context:example");
    expect(ctx.facts).toHaveLength(1);
    input.facts.push({ id: "urn:ulcs:fact:2", "@type": "Fact", content: "mutated?" });
    expect(ctx.facts).toHaveLength(1);
  });
});

describe("normalizeContext", () => {
  it("fills missing arrays and defaults trust/status", () => {
    const ctx = createContext({
      facts: [{ id: "urn:ulcs:fact:1", "@type": "Fact", content: "x" }],
      assumptions: [{ id: "urn:ulcs:assum:1", "@type": "Assumption", content: "y" }],
    });
    const normalized = normalizeContext(ctx);
    expect(normalized.facts?.[0]?.status).toBe("confirmed");
    expect(normalized.assumptions?.[0]?.status).toBe("unconfirmed");
    expect(normalized.facts?.[0]?.trust).toEqual({
      level: "unknown",
      providesData: true,
      providesInstructions: false,
    });
  });

  it("forces providesInstructions=false when trust.level is untrusted", () => {
    const ctx = createContext({
      resources: [
        {
          id: "urn:ulcs:res:1",
          "@type": "Resource",
          uri: "https://example.com",
          trust: { level: "untrusted", providesInstructions: true },
        },
      ],
    });
    const normalized = normalizeContext(ctx);
    expect(normalized.resources?.[0]?.trust?.providesInstructions).toBe(false);
  });

  it("deduplicates and alphabetizes tags/scope", () => {
    const ctx = createContext({
      facts: [
        {
          id: "urn:ulcs:fact:1",
          "@type": "Fact",
          content: "x",
          tags: ["b", "a", "b"],
          scope: ["session", "current-task"],
        },
      ],
    });
    const normalized = normalizeContext(ctx);
    expect(normalized.facts?.[0]?.tags).toEqual(["a", "b"]);
    expect(normalized.facts?.[0]?.scope).toEqual(["current-task", "session"]);
  });

  it("does not mutate its input", () => {
    const ctx = createContext({
      facts: [{ id: "urn:ulcs:fact:1", "@type": "Fact", content: "x" }],
    });
    const frozen = JSON.stringify(ctx);
    normalizeContext(ctx);
    expect(JSON.stringify(ctx)).toBe(frozen);
  });

  it("preserves conversation order (never reorders it)", () => {
    const ctx = createContext({
      conversation: [
        { id: "urn:ulcs:msg:1", "@type": "ConversationMessage", role: "user", content: "first" },
        {
          id: "urn:ulcs:msg:2",
          "@type": "ConversationMessage",
          role: "assistant",
          content: "second",
        },
      ],
    });
    const normalized = normalizeContext(ctx);
    expect(normalized.conversation?.map((m) => m.id)).toEqual(["urn:ulcs:msg:1", "urn:ulcs:msg:2"]);
  });
});
