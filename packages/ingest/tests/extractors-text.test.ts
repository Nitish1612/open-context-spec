import { describe, expect, it } from "vitest";
import { textExtractor, markdownExtractor } from "../src/index.js";
import type { ResolvedInput } from "../src/index.js";

function bufInput(content: string, filename: string): ResolvedInput {
  return { source: { kind: "text", content }, data: new TextEncoder().encode(content), filename };
}

describe("text extractor", () => {
  it("extracts plain text as a single section and records a content hash", async () => {
    const doc = await textExtractor.extract(bufInput("hello world", "a.txt"), {});
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]?.content).toBe("hello world");
    expect(doc.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("warns on empty content instead of silently succeeding", async () => {
    const doc = await textExtractor.extract(bufInput("   \n  ", "empty.txt"), {});
    expect(doc.warnings.some((w) => w.code === "empty-content")).toBe(true);
  });

  it("is deterministic: identical input produces identical content hash", async () => {
    const a = await textExtractor.extract(bufInput("same", "a.txt"), {});
    const b = await textExtractor.extract(bufInput("same", "b.txt"), {});
    expect(a.contentHash).toBe(b.contentHash);
  });
});

describe("markdown extractor", () => {
  it("splits sections at headings and preserves heading levels", async () => {
    const md = "# Title\n\nIntro text.\n\n## Sub\n\nSub text.\n";
    const doc = await markdownExtractor.extract(bufInput(md, "doc.md"), {});
    expect(doc.sections.map((s) => s.title)).toEqual(["Title", "Sub"]);
    expect(doc.sections[0]?.metadata?.headingLevel).toBe(1);
    expect(doc.sections[1]?.metadata?.headingLevel).toBe(2);
    expect(doc.title).toBe("Title");
  });

  it("does not treat a '#' inside a fenced code block as a heading", async () => {
    const md = "# Real Heading\n\n```\n# not a heading\ncode line\n```\n";
    const doc = await markdownExtractor.extract(bufInput(md, "doc.md"), {});
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]?.content).toContain("# not a heading");
    expect(doc.sections[0]?.content).toContain("code line");
  });

  it("preserves content with no headings as a single section", async () => {
    const doc = await markdownExtractor.extract(
      bufInput("Just a paragraph, no headings.", "doc.md"),
      {},
    );
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]?.title).toBeUndefined();
  });
});
