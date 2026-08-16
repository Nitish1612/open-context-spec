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

describe("chunkDocument", () => {
  it("produces zero chunks for a document with no sections", () => {
    expect(chunkDocument(makeDoc([]))).toEqual([]);
  });

  it("'none' strategy maps sections 1:1 to chunks without merging or splitting", () => {
    const doc = makeDoc([
      { id: "s0", content: "First section text long enough to keep on its own merits here." },
      { id: "s1", content: "Second section text also long enough to stand alone in this test." },
    ]);
    const chunks = chunkDocument(doc, { strategy: "none", deduplicate: false });
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.content).toContain("First section");
    expect(chunks[1]?.content).toContain("Second section");
  });

  it("'rows' strategy never splits an individual row across chunks", () => {
    const sections: ExtractedSection[] = Array.from({ length: 5 }, (_, i) => ({
      id: `row${i}`,
      rowStart: i + 2,
      rowEnd: i + 2,
      content: `row ${i} content padded to be reasonably sized for the test case here`,
    }));
    const chunks = chunkDocument(makeDoc(sections), {
      strategy: "rows",
      maxChars: 90,
      minChunkSize: 1,
    });
    for (const chunk of chunks) {
      // Every row that appears in a chunk must appear whole (not truncated mid-word).
      expect(chunk.content).not.toMatch(
        /content padded to be reasonably sized for the test case her$/,
      );
    }
    const totalRowsCovered = chunks.reduce(
      (sum, c) => sum + (c.content.match(/row \d+ content/g)?.length ?? 0),
      0,
    );
    expect(totalRowsCovered).toBe(5);
  });

  it("respects maxChars for the 'characters' strategy and produces overlap without duplicate ids", () => {
    const longText = "word ".repeat(500);
    const doc = makeDoc([{ id: "s0", content: longText }]);
    const chunks = chunkDocument(doc, {
      strategy: "characters",
      maxChars: 200,
      overlap: 20,
      deduplicate: false,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.content.length).toBeLessThanOrEqual(220);
    const ids = chunks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never splits a UTF-16 surrogate pair when chunking by characters", () => {
    const emoji = "😀".repeat(200); // each emoji is a surrogate pair (2 UTF-16 code units)
    const doc = makeDoc([{ id: "s0", content: emoji }]);
    const chunks = chunkDocument(doc, {
      strategy: "characters",
      maxChars: 50,
      overlap: 0,
      deduplicate: false,
    });
    for (const chunk of chunks) {
      // A broken surrogate pair produces the U+FFFD replacement character when re-encoded;
      // a chunk built from valid slice boundaries never contains a lone surrogate.
      expect(
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
          chunk.content,
        ),
      ).toBe(false);
    }
  });

  it("deduplicates identical chunk content when deduplicate is enabled", () => {
    const doc = makeDoc([
      {
        id: "s0",
        content: "Repeated content that is long enough to pass the minimum chunk size check.",
      },
      {
        id: "s1",
        content: "Repeated content that is long enough to pass the minimum chunk size check.",
      },
    ]);
    const chunks = chunkDocument(doc, { strategy: "none", deduplicate: true });
    expect(chunks).toHaveLength(1);
  });

  it("removes empty sections when removeEmpty is enabled", () => {
    const doc = makeDoc([
      { id: "s0", content: "   " },
      { id: "s1", content: "Real content here that is long enough to survive on its own." },
    ]);
    const chunks = chunkDocument(doc, { strategy: "none", removeEmpty: true });
    expect(chunks).toHaveLength(1);
  });

  it("generates stable, deterministic chunk ids for the same document and options", () => {
    const doc = makeDoc([
      { id: "s0", content: "Stable content for id determinism testing purposes here." },
    ]);
    const a = chunkDocument(doc, { strategy: "none" });
    const b = chunkDocument(doc, { strategy: "none" });
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
  });

  it("preserves page/slide/sheet metadata through structural chunking", () => {
    const doc = makeDoc([
      {
        id: "s0",
        page: 1,
        content: "Page one content that is long enough to stand alone in this test case.",
      },
      {
        id: "s1",
        page: 2,
        content: "Page two content that is long enough to stand alone in this test case.",
      },
    ]);
    const chunks = chunkDocument(doc, { strategy: "pages" });
    expect(chunks.map((c) => c.page)).toEqual([1, 2]);
  });

  it("never silently drops non-empty content below minChunkSize", () => {
    const doc = makeDoc([
      { id: "s0", content: "tiny" },
      { id: "s1", content: "also tiny" },
    ]);
    const chunks = chunkDocument(doc, { strategy: "none", minChunkSize: 1000, deduplicate: false });
    const totalChars = chunks.reduce((sum, c) => sum + c.content.length, 0);
    expect(totalChars).toBeGreaterThanOrEqual("tiny".length + "also tiny".length);
  });
});
