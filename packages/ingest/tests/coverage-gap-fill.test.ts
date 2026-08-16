import { symlinkSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  sniffMediaType,
  isLikelyValidUtf8,
  inferFilename,
  listBuiltInExtractors,
  jsonExtractor,
  pdfExtractor,
  CapabilityUnavailableError,
  SecurityRejectionError,
  assertNoSymlinkEscape,
} from "../src/index.js";
import type { ResolvedInput, OcrProvider } from "../src/index.js";
import { splitOversizedContent } from "../src/chunking/structured.js";
import { splitIntoSentences, packUnits } from "../src/chunking/text.js";
import { minimalDocxBytes, minimalPptxBytes, minimalXlsxBytes } from "./fixtures.js";

describe("sniffMediaType", () => {
  it("returns undefined for an empty buffer", () => {
    expect(sniffMediaType(new Uint8Array())).toBeUndefined();
  });

  it("returns undefined for unrecognizable binary data", () => {
    expect(sniffMediaType(new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]))).toBeUndefined();
  });

  it("detects a generic zip as application/zip when it isn't an OOXML office document", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("hello.txt", "hi");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    expect(sniffMediaType(bytes)).toBe("application/zip");
  });

  it("detects docx/pptx/xlsx by their internal zip entry names", async () => {
    expect(sniffMediaType(await minimalDocxBytes())).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(sniffMediaType(await minimalPptxBytes())).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(sniffMediaType(await minimalXlsxBytes())).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  it("strips a UTF-8 BOM before sniffing text-based formats", () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const jsonBytes = new TextEncoder().encode('{"a":1}');
    const combined = new Uint8Array(bom.length + jsonBytes.length);
    combined.set(bom);
    combined.set(jsonBytes, bom.length);
    expect(sniffMediaType(combined)).toBe("application/json");
  });
});

describe("isLikelyValidUtf8", () => {
  it("is true for valid UTF-8 text", () => {
    expect(isLikelyValidUtf8(new TextEncoder().encode("hello, world"))).toBe(true);
  });

  it("is false for an invalid UTF-8 byte sequence", () => {
    expect(isLikelyValidUtf8(new Uint8Array([0xff, 0xfe, 0x00, 0x80]))).toBe(false);
  });
});

describe("inferFilename", () => {
  it("prefers an explicit filename over the source", () => {
    const input: ResolvedInput = {
      source: { kind: "text", content: "x" },
      filename: "explicit.txt",
    };
    expect(inferFilename(input)).toBe("explicit.txt");
  });

  it("derives a filename from a file source path", () => {
    const input: ResolvedInput = { source: { kind: "file", path: "/a/b/c.txt" } };
    expect(inferFilename(input)).toBe("c.txt");
  });

  it("derives a filename from a buffer source", () => {
    const input: ResolvedInput = {
      source: { kind: "buffer", data: new Uint8Array(), filename: "d.csv" },
    };
    expect(inferFilename(input)).toBe("d.csv");
  });

  it("derives a filename from a text source name", () => {
    const input: ResolvedInput = { source: { kind: "text", content: "x", name: "note.md" } };
    expect(inferFilename(input)).toBe("note.md");
  });

  it("derives a filename from a URL path", () => {
    const input: ResolvedInput = {
      source: { kind: "url", url: "https://example.com/dir/report.pdf" },
    };
    expect(inferFilename(input)).toBe("report.pdf");
  });

  it("returns undefined for a URL with no path segment", () => {
    const input: ResolvedInput = { source: { kind: "url", url: "https://example.com" } };
    expect(inferFilename(input)).toBeUndefined();
  });

  it("returns undefined when nothing identifies a filename", () => {
    const input: ResolvedInput = { source: { kind: "buffer", data: new Uint8Array() } };
    expect(inferFilename(input)).toBeUndefined();
  });
});

describe("every built-in extractor's supports() predicate is truthy for its own format", () => {
  const cases: Record<string, ResolvedInput> = {
    text: { source: { kind: "text", content: "x" }, filename: "a.txt", mediaType: "text/plain" },
    markdown: {
      source: { kind: "text", content: "# x" },
      filename: "a.md",
      mediaType: "text/markdown",
    },
    json: {
      source: { kind: "text", content: "{}" },
      filename: "a.json",
      mediaType: "application/json",
    },
    jsonl: {
      source: { kind: "text", content: "{}" },
      filename: "a.jsonl",
      mediaType: "application/x-ndjson",
    },
    csv: { source: { kind: "text", content: "a,b" }, filename: "a.csv", mediaType: "text/csv" },
    tsv: {
      source: { kind: "text", content: "a\tb" },
      filename: "a.tsv",
      mediaType: "text/tab-separated-values",
    },
    html: {
      source: { kind: "text", content: "<p>x</p>" },
      filename: "a.html",
      mediaType: "text/html",
    },
    xml: {
      source: { kind: "text", content: "<a/>" },
      filename: "a.xml",
      mediaType: "application/xml",
    },
    pdf: { source: { kind: "text", content: "" }, filename: "a.pdf", mediaType: "application/pdf" },
    docx: {
      source: { kind: "text", content: "" },
      filename: "a.docx",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
    pptx: {
      source: { kind: "text", content: "" },
      filename: "a.pptx",
      mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    },
    xlsx: {
      source: { kind: "text", content: "" },
      filename: "a.xlsx",
      mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  };

  for (const extractor of listBuiltInExtractors()) {
    it(`${extractor.id} recognizes its own filename+mediaType combination`, async () => {
      const input = cases[extractor.id];
      expect(input, `no test case for extractor id "${extractor.id}"`).toBeDefined();
      const result = await extractor.supports(input as ResolvedInput);
      expect(result).not.toBe(false);
    });

    it(`${extractor.id} declines an unrelated input`, async () => {
      const unrelated: ResolvedInput = {
        source: { kind: "text", content: "x" },
        filename: "a.zzzzz",
      };
      const result = await extractor.supports(unrelated);
      expect(result).toBe(false);
    });
  }
});

describe("PDF OCR option branches", () => {
  it("throws CapabilityUnavailableError when --ocr is requested with no provider configured", async () => {
    const { minimalPdfBytes } = await import("./fixtures.js");
    // A page with only a non-text drawing operator (no Tj text-show) is treated as image-only.
    const blankPagePdf = new TextEncoder().encode(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 10 >>\nstream\n0 0 0 rg\nendstream\nendobj\ntrailer\n<< /Size 5 /Root 1 0 R >>\n%%EOF",
    );
    await expect(
      pdfExtractor.extract(
        {
          source: { kind: "buffer", data: blankPagePdf, filename: "blank.pdf" },
          data: blankPagePdf,
        },
        { ocr: true },
      ),
    ).rejects.toThrow(CapabilityUnavailableError);
    void minimalPdfBytes;
  });

  it("warns (rather than failing) when --ocr is requested WITH a provider configured", async () => {
    const blankPagePdf = new TextEncoder().encode(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 10 >>\nstream\n0 0 0 rg\nendstream\nendobj\ntrailer\n<< /Size 5 /Root 1 0 R >>\n%%EOF",
    );
    const provider: OcrProvider = { id: "noop", recognize: async () => "recognized text" };
    const doc = await pdfExtractor.extract(
      { source: { kind: "buffer", data: blankPagePdf, filename: "blank.pdf" }, data: blankPagePdf },
      { ocr: true, ocrProvider: provider },
    );
    expect(doc.warnings.some((w) => w.code === "unsupported-feature")).toBe(true);
  });
});

describe("chunking helper edge cases", () => {
  it("splitIntoSentences keeps an abbreviation attached to its sentence", () => {
    const sentences = splitIntoSentences("Dr. Smith arrived. He was early.");
    expect(sentences.some((s) => s.includes("Dr. Smith arrived."))).toBe(true);
  });

  it("packUnits packs multiple short units into one window under the budget", () => {
    const windows = packUnits(["a", "b", "c"], 100);
    expect(windows).toHaveLength(1);
  });

  it("splitOversizedContent packs multiple paragraphs and sub-splits an over-budget one", () => {
    const paragraphs = Array.from({ length: 5 }, (_, i) => `Paragraph ${i} `.repeat(20)).join(
      "\n\n",
    );
    const pieces = splitOversizedContent(paragraphs, 200, 10);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(220);
  });

  it("splitOversizedContent falls through to raw character splitting for a single giant paragraph", () => {
    const singleParagraph = "word ".repeat(400);
    const pieces = splitOversizedContent(singleParagraph, 200, 10);
    expect(pieces.length).toBeGreaterThan(1);
  });
});

describe("json extractor: maxSections enforcement", () => {
  it("rejects an array exceeding maxSections", async () => {
    const arr = JSON.stringify(Array.from({ length: 10 }, (_, i) => i));
    await expect(
      jsonExtractor.extract(
        {
          source: { kind: "text", content: arr },
          data: new TextEncoder().encode(arr),
          filename: "d.json",
        },
        { limits: { maxSections: 3 } },
      ),
    ).rejects.toThrow(SecurityRejectionError);
  });

  it("rejects a top-level object exceeding maxSections (key count)", async () => {
    const obj = JSON.stringify({ a: 1, b: 2, c: 3, d: 4, e: 5 });
    await expect(
      jsonExtractor.extract(
        {
          source: { kind: "text", content: obj },
          data: new TextEncoder().encode(obj),
          filename: "d.json",
        },
        { limits: { maxSections: 2 } },
      ),
    ).rejects.toThrow(SecurityRejectionError);
  });
});

describe("assertNoSymlinkEscape with a real symlink", () => {
  const canSymlink = (() => {
    try {
      const testDir = mkdtempSync(join(tmpdir(), "ulcs-symlink-escape-check-"));
      symlinkSync(testDir, join(testDir, "self-link"));
      rmSync(testDir, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!canSymlink)("throws when a symlink resolves outside the allowed root", () => {
    const outsideDir = mkdtempSync(join(tmpdir(), "ulcs-outside-"));
    const rootDir = mkdtempSync(join(tmpdir(), "ulcs-root-"));
    const target = join(outsideDir, "secret.txt");
    writeFileSync(target, "secret");
    const link = join(rootDir, "escape-link");
    symlinkSync(target, link);
    try {
      expect(() => assertNoSymlinkEscape(link, rootDir)).toThrow(SecurityRejectionError);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it.skipIf(!canSymlink)("does not throw when a symlink stays within the allowed root", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "ulcs-root2-"));
    const target = join(rootDir, "real.txt");
    writeFileSync(target, "hi");
    const link = join(rootDir, "in-root-link");
    symlinkSync(target, link);
    try {
      expect(() => assertNoSymlinkEscape(link, rootDir)).not.toThrow();
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
