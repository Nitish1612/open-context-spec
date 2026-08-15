import { describe, expect, it } from "vitest";
import { createContext } from "@ulcs/core";
import { validateContext, validateContextItem, validateContextPatch } from "../src/index.js";

describe("validateContext", () => {
  it("accepts a minimal valid envelope", () => {
    const ctx = createContext({
      id: "urn:ulcs:context:example",
      facts: [{ id: "urn:ulcs:fact:1", "@type": "Fact", content: "The sky is blue." }],
    });
    const result = validateContext(ctx);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a document missing required fields, with a JSON Pointer path", () => {
    const result = validateContext({ "@type": "ContextEnvelope" });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.path === "")).toBe(true);
  });

  it("rejects an untrusted item that claims to provide instructions", () => {
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
    const result = validateContext(ctx);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes("/resources/0"))).toBe(true);
  });

  it("rejects out-of-range priority", () => {
    const ctx = createContext({
      facts: [{ id: "urn:ulcs:fact:1", "@type": "Fact", content: "x", priority: 150 }],
    });
    const result = validateContext(ctx);
    expect(result.valid).toBe(false);
  });

  it("preserves and permits namespaced extension fields", () => {
    const ctx = createContext({
      facts: [
        {
          id: "urn:ulcs:fact:1",
          "@type": "Fact",
          content: "x",
          extensions: { "x-acme:internalScore": 0.42 },
        },
      ],
    });
    const result = validateContext(ctx);
    expect(result.valid).toBe(true);
  });

  it("rejects an Instruction missing its required authority field", () => {
    const ctx = createContext({
      instructions: [{ id: "urn:ulcs:instr:1", "@type": "Instruction", content: "Do X" } as never],
    });
    const result = validateContext(ctx);
    expect(result.valid).toBe(false);
  });
});

describe("validateContextItem", () => {
  it("validates a standalone Fact item", () => {
    const result = validateContextItem({ id: "urn:ulcs:fact:1", "@type": "Fact", content: "x" });
    expect(result.valid).toBe(true);
  });

  it("rejects an unknown @type", () => {
    const result = validateContextItem({
      id: "urn:ulcs:fact:1",
      "@type": "NotARealType",
      content: "x",
    });
    expect(result.valid).toBe(false);
  });
});

describe("validateContextPatch", () => {
  it("validates a well-formed patch", () => {
    const result = validateContextPatch({
      "@type": "ContextPatch",
      id: "urn:ulcs:patch:1",
      operations: [{ op: "replace", path: "/schemaVersion", value: "1.0.1" }],
    });
    expect(result.valid).toBe(true);
  });

  it("rejects an add operation missing a value", () => {
    const result = validateContextPatch({
      "@type": "ContextPatch",
      id: "urn:ulcs:patch:1",
      operations: [{ op: "add", path: "/facts/-" }],
    });
    expect(result.valid).toBe(false);
  });
});
