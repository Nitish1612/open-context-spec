import { describe, expect, it } from "vitest";
import { chunkDocument } from "../src/index.js";
import type { ExtractedDocument, ExtractedSection } from "../src/index.js";

function makeDoc(
  sections: ExtractedSection[],
  contentHash = "abc123abc123abc123",
): ExtractedDocument {
  return {
    id: `doc:${contentHash.slice(0, 16)}`,
    mediaType: "text/plain",
    contentHash,
    byteLength: 100,
    extractedAt: new Date(0).toISOString(),
    sections,
    metadata: {},
    warnings: [],
  };
}

describe("Defect 8: maxTokens is actually enforced", () => {
  it("splits a chunk that would otherwise exceed maxTokens", () => {
    const longText = "word ".repeat(2000); // ~10,000 chars, far more than a small token budget
    const doc = makeDoc([{ id: "s0", content: longText }]);
    const chunks = chunkDocument(doc, {
      strategy: "paragraphs",
      maxChars: 100_000,
      maxTokens: 50,
      deduplicate: false,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenEstimate).toBeLessThanOrEqual(50);
    }
  });

  it("enforces both maxChars and maxTokens together (the tighter one wins per-chunk)", () => {
    const longText = "word ".repeat(2000);
    const doc = makeDoc([{ id: "s0", content: longText }]);
    const chunks = chunkDocument(doc, {
      strategy: "paragraphs",
      maxChars: 200,
      maxTokens: 10_000,
      deduplicate: false,
    });
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(220);
    }
  });

  it("rejects a non-positive maxTokens", () => {
    const doc = makeDoc([{ id: "s0", content: "hello" }]);
    expect(() => chunkDocument(doc, { maxTokens: 0 })).toThrow();
    expect(() => chunkDocument(doc, { maxTokens: -5 })).toThrow();
  });

  it("rejects a fractional maxTokens", () => {
    const doc = makeDoc([{ id: "s0", content: "hello" }]);
    expect(() => chunkDocument(doc, { maxTokens: 4.5 })).toThrow();
  });

  it("flags (rather than splits) an indivisible oversized row via metadata.maxTokensExceeded", () => {
    const hugeRow = "field: " + "x".repeat(5000);
    const doc = makeDoc([{ id: "s0", rowStart: 2, rowEnd: 2, content: hugeRow }]);
    const chunks = chunkDocument(doc, { strategy: "rows", maxTokens: 5, maxChars: 100_000 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.metadata?.maxTokensExceeded).toBe(true);
    // The full row content must still be present — never silently dropped.
    expect(chunks[0]?.content).toBe(hugeRow);
  });

  it("does not affect chunking when maxTokens is not set", () => {
    const doc = makeDoc([{ id: "s0", content: "short content here" }]);
    const chunks = chunkDocument(doc, { strategy: "none" });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.metadata?.maxTokensExceeded).toBeUndefined();
  });
});

describe("Defect 8: preserveStructuralBoundary changes actual output", () => {
  function makeStructuredDoc(): ExtractedDocument {
    return makeDoc([
      { id: "s0", page: 1, content: "Page one short content." },
      { id: "s1", page: 2, content: "Page two short content." },
      { id: "s2", page: 3, content: "Page three short content." },
    ]);
  }

  it("true (default): never mixes pages into one chunk even when they'd fit together", () => {
    const doc = makeStructuredDoc();
    const chunks = chunkDocument(doc, {
      strategy: "pages",
      maxChars: 10_000,
      preserveStructuralBoundary: true,
    });
    expect(chunks).toHaveLength(3);
    expect(chunks.every((c) => c.sourceLocators === undefined)).toBe(true);
    expect(chunks.map((c) => c.page)).toEqual([1, 2, 3]);
  });

  it("false: packs adjacent pages together when they fit within maxChars, recording sourceLocators", () => {
    const doc = makeStructuredDoc();
    const chunks = chunkDocument(doc, {
      strategy: "pages",
      maxChars: 10_000,
      preserveStructuralBoundary: false,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toContain("Page one");
    expect(chunks[0]?.content).toContain("Page two");
    expect(chunks[0]?.content).toContain("Page three");
    expect(chunks[0]?.sourceLocators).toBeDefined();
    expect(chunks[0]?.sourceLocators?.map((l) => l.page)).toEqual([1, 2, 3]);
  });

  it("false: still never splits an individual row, even when packing across sheets", () => {
    const doc = makeDoc([
      { id: "s0", sheet: "One", rowStart: 2, rowEnd: 2, content: "row one content" },
      { id: "s1", sheet: "Two", rowStart: 2, rowEnd: 2, content: "row two content" },
    ]);
    const chunks = chunkDocument(doc, {
      strategy: "rows",
      maxChars: 10_000,
      preserveStructuralBoundary: false,
    });
    // Both rows fit in one packed chunk, but each row's text must appear whole.
    const allContent = chunks.map((c) => c.content).join("\n");
    expect(allContent).toContain("row one content");
    expect(allContent).toContain("row two content");
  });

  it("false: still respects maxChars, splitting into multiple packed windows when content doesn't all fit", () => {
    const doc = makeStructuredDoc();
    const chunks = chunkDocument(doc, {
      strategy: "pages",
      maxChars: 40,
      preserveStructuralBoundary: false,
    });
    expect(chunks.length).toBeGreaterThan(1);
  });
});
