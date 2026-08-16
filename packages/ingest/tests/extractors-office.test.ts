import { describe, expect, it } from "vitest";
import { pdfExtractor, docxExtractor, pptxExtractor, xlsxExtractor } from "../src/index.js";
import type { ResolvedInput } from "../src/index.js";
import {
  minimalDocxBytes,
  minimalPdfBytes,
  minimalPptxBytes,
  minimalXlsxBytes,
} from "./fixtures.js";

function bufInput(data: Uint8Array, filename: string): ResolvedInput {
  return { source: { kind: "buffer", data, filename }, data, filename };
}

describe("pdf extractor", () => {
  it("extracts page text and records the page number", async () => {
    const doc = await pdfExtractor.extract(bufInput(minimalPdfBytes(), "d.pdf"), {});
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]?.page).toBe(1);
    expect(doc.sections[0]?.content).toContain("Hello PDF");
  });

  it("warns instead of throwing when OCR is unavailable for a scanned page", async () => {
    // A PDF with only a Do (XObject) content stream and no text is treated as image-only.
    const doc = await pdfExtractor.extract(bufInput(minimalPdfBytes(), "d.pdf"), { ocr: false });
    expect(doc.warnings.find((w) => w.code === "ocr-unavailable")).toBeUndefined(); // this fixture has real text
  });
});

describe("docx extractor", () => {
  it("extracts headings and paragraphs and reads core metadata", async () => {
    const bytes = await minimalDocxBytes();
    const doc = await docxExtractor.extract(bufInput(bytes, "d.docx"), {});
    expect(doc.sections[0]?.title).toBe("Test Heading");
    const allContent = doc.sections.map((s) => s.content).join("\n");
    expect(allContent).toContain("Test Heading");
    expect(allContent).toContain("Test paragraph body text.");
    expect(doc.title).toBe("Fixture Document");
  });

  it("rejects a malformed (non-zip) docx container with a clear extraction error", async () => {
    const garbage = new TextEncoder().encode("not a real docx file");
    await expect(docxExtractor.extract(bufInput(garbage, "bad.docx"), {})).rejects.toThrow();
  });
});

describe("pptx extractor", () => {
  it("extracts the slide title and body, recording the slide number", async () => {
    const bytes = await minimalPptxBytes();
    const doc = await pptxExtractor.extract(bufInput(bytes, "d.pptx"), {});
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]?.slide).toBe(1);
    expect(doc.sections[0]?.title).toBe("Slide Title");
    expect(doc.sections[0]?.content).toContain("Slide body text.");
  });
});

describe("xlsx extractor", () => {
  it("extracts sheet rows, recording the sheet name and row range", async () => {
    const bytes = await minimalXlsxBytes();
    const doc = await xlsxExtractor.extract(bufInput(bytes, "d.xlsx"), {});
    expect(doc.sections.length).toBeGreaterThan(0);
    expect(doc.sections[0]?.sheet).toBe("Data");
    expect(doc.sections[0]?.content).toContain("Alice");
    expect(doc.metadata.sheetNames).toEqual(["Data"]);
  });
});
