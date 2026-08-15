import { describe, expect, it } from "vitest";
import { compareContexts, createContext, exportContext, redactContext } from "../src/index.js";

describe("redactContext", () => {
  it("redacts content per explicit handling rule", () => {
    const ctx = createContext({
      facts: [
        {
          id: "urn:ulcs:fact:1",
          "@type": "Fact",
          content: "SSN: 123-45-6789",
          sensitivity: { level: "personal", handling: [{ rule: "redact" }] },
        },
      ],
    });
    const { context, redactedCount } = redactContext(ctx);
    expect(context.facts?.[0]?.content).toBe("[REDACTED]");
    expect(redactedCount).toBe(1);
  });

  it("excludes items entirely with rule=exclude, and applies safe defaults for restricted/secret with no explicit rule", () => {
    const ctx = createContext({
      facts: [
        {
          id: "urn:ulcs:fact:1",
          "@type": "Fact",
          content: "top secret",
          sensitivity: { level: "secret" },
        },
        {
          id: "urn:ulcs:fact:2",
          "@type": "Fact",
          content: "public info",
          sensitivity: { level: "public" },
        },
      ],
    });
    const { context, excluded } = redactContext(ctx);
    expect(context.facts?.map((f) => f.id)).toEqual(["urn:ulcs:fact:2"]);
    expect(excluded).toHaveLength(1);
    expect(excluded[0]?.id).toBe("urn:ulcs:fact:1");
  });

  it("flags require-consent and local-only items but keeps them present", () => {
    const ctx = createContext({
      facts: [
        {
          id: "urn:ulcs:fact:1",
          "@type": "Fact",
          content: "needs consent",
          sensitivity: { level: "personal", handling: [{ rule: "require-consent" }] },
        },
        {
          id: "urn:ulcs:fact:2",
          "@type": "Fact",
          content: "local only",
          sensitivity: { level: "secret", handling: [{ rule: "local-only" }] },
        },
      ],
    });
    const { context, requiresConsent, localOnly } = redactContext(ctx);
    expect(context.facts).toHaveLength(2);
    expect(requiresConsent).toHaveLength(1);
    expect(localOnly).toHaveLength(1);
    expect(context.facts?.[0]?.extensions?.["x-ulcs:redaction"]).toBeDefined();
  });

  it("respects boundary-scoped handling rules", () => {
    const ctx = createContext({
      facts: [
        {
          id: "urn:ulcs:fact:1",
          "@type": "Fact",
          content: "sensitive",
          sensitivity: {
            level: "confidential",
            handling: [
              { rule: "allow", appliesTo: "internal-log" },
              { rule: "exclude", appliesTo: "export" },
            ],
          },
        },
      ],
    });
    const forExport = redactContext(ctx, { boundary: "export" });
    const forLog = redactContext(ctx, { boundary: "internal-log" });
    expect(forExport.context.facts).toHaveLength(0);
    expect(forLog.context.facts).toHaveLength(1);
  });

  it("uses a custom summarizer when provided", () => {
    const ctx = createContext({
      facts: [
        {
          id: "urn:ulcs:fact:1",
          "@type": "Fact",
          content: "a very long sensitive paragraph",
          sensitivity: { level: "confidential", handling: [{ rule: "summarize" }] },
        },
      ],
    });
    const { context } = redactContext(ctx, { summarizer: () => "short summary" });
    expect(context.facts?.[0]?.content).toBe("short summary");
  });
});

describe("exportContext", () => {
  it("exports json and json-ld with identical parsed content", () => {
    const ctx = createContext({
      facts: [{ id: "urn:ulcs:fact:1", "@type": "Fact", content: "x" }],
    });
    const json = exportContext(ctx, "json");
    const jsonLd = exportContext(ctx, "json-ld");
    expect(JSON.parse(json)).toEqual(JSON.parse(jsonLd));
  });

  it("exports a markdown archival dump", () => {
    const ctx = createContext({
      objective: { id: "urn:ulcs:obj:1", "@type": "Objective", summary: "Do the thing" },
      facts: [{ id: "urn:ulcs:fact:1", "@type": "Fact", content: "x" }],
    });
    const md = exportContext(ctx, "markdown");
    expect(md).toContain("## Objective");
    expect(md).toContain("Do the thing");
    expect(md).toContain("## Facts");
  });
});

describe("compareContexts", () => {
  it("reports added, removed, and changed items deterministically", () => {
    const before = createContext({
      facts: [
        { id: "urn:ulcs:fact:1", "@type": "Fact", content: "unchanged" },
        { id: "urn:ulcs:fact:2", "@type": "Fact", content: "will change" },
        { id: "urn:ulcs:fact:3", "@type": "Fact", content: "will be removed" },
      ],
    });
    const after = createContext({
      facts: [
        { id: "urn:ulcs:fact:1", "@type": "Fact", content: "unchanged" },
        { id: "urn:ulcs:fact:2", "@type": "Fact", content: "changed!" },
        { id: "urn:ulcs:fact:4", "@type": "Fact", content: "newly added" },
      ],
    });
    const diff = compareContexts(before, after);
    const kinds = diff.entries.map((e) => `${e.kind}:${e.id}`);
    expect(kinds).toEqual([
      "changed:urn:ulcs:fact:2",
      "removed:urn:ulcs:fact:3",
      "added:urn:ulcs:fact:4",
    ]);
  });
});
