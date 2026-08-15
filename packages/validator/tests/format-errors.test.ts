import { describe, expect, it } from "vitest";
import { formatValidationErrors, getAjv, validateContext } from "../src/index.js";

describe("formatValidationErrors", () => {
  it("labels a root-level error as (root)", () => {
    const result = validateContext({ "@type": "ContextEnvelope" });
    const lines = formatValidationErrors(result.errors);
    expect(lines.some((line) => line.startsWith("(root):"))).toBe(true);
  });

  it("includes the JSON Pointer path for a nested error", () => {
    const result = validateContext({
      "@context": "https://ulcs.dev/context/v1",
      "@type": "ContextEnvelope",
      schemaVersion: "1.0.0",
      id: "urn:ulcs:context:x",
      createdAt: "2026-08-15T00:00:00Z",
      facts: [{ id: "urn:ulcs:fact:1", "@type": "Fact", content: "x", priority: 999 }],
    });
    const lines = formatValidationErrors(result.errors);
    expect(lines.some((line) => line.startsWith("/facts/0/priority:"))).toBe(true);
  });
});

describe("getAjv", () => {
  it("memoizes the Ajv instance across calls", () => {
    expect(getAjv()).toBe(getAjv());
  });
});
