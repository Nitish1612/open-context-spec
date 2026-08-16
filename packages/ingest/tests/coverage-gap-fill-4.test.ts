import { describe, expect, it } from "vitest";
import {
  jsonlExtractor,
  csvExtractor,
  pdfExtractor,
  pptxExtractor,
  xlsxExtractor,
  mapDocumentsToContext,
  chunkDocument,
  ExtractionError,
} from "../src/index.js";
import type { ResolvedInput, ExtractedDocument } from "../src/index.js";
import { toPortablePath, SymlinkLoopGuard } from "../src/security/paths.js";
import { groupSections } from "../src/chunking/structured.js";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import ExcelJS from "exceljs";

function bufInput(data: Uint8Array, filename: string): ResolvedInput {
  return { source: { kind: "buffer", data, filename }, data, filename };
}
function textInput(content: string, filename: string): ResolvedInput {
  const data = new TextEncoder().encode(content);
  return { source: { kind: "text", content }, data, filename };
}

describe("jsonl extractor: invalid UTF-8 handling (Defect 12)", () => {
  function invalidBytes(): Uint8Array {
    return new Uint8Array([
      ...new TextEncoder().encode('{"a":1}\n{"b":"'),
      0xff,
      0xfe,
      ...new TextEncoder().encode('"}\n'),
    ]);
  }

  it("rejects invalid UTF-8 byte sequences by default", async () => {
    await expect(jsonlExtractor.extract(bufInput(invalidBytes(), "bad.jsonl"), {})).rejects.toThrow(
      ExtractionError,
    );
  });

  it("warns (rather than rejects) on invalid UTF-8 when tolerantTextDecoding is set", async () => {
    const doc = await jsonlExtractor.extract(bufInput(invalidBytes(), "bad.jsonl"), {
      tolerantTextDecoding: true,
      maxInvalidSequenceRatio: 1,
    });
    expect(
      doc.warnings.some((w) => w.code === "malformed-content" && w.message.includes("UTF-8")),
    ).toBe(true);
  });
});

describe("csv extractor: quoting edge cases", () => {
  it("handles an escaped double-quote inside a quoted field", async () => {
    const csv = 'name,quote\nAlice,"She said ""hi"" to me"\n';
    const doc = await csvExtractor.extract(textInput(csv, "d.csv"), {});
    expect(doc.sections[0]?.content).toContain('She said "hi" to me');
  });

  it("handles CRLF line endings", async () => {
    const csv = "a,b\r\n1,2\r\n3,4\r\n";
    const doc = await csvExtractor.extract(textInput(csv, "d.csv"), {});
    expect(doc.sections).toHaveLength(2);
  });
});

describe("pdf extractor: Info dictionary title", () => {
  it("uses the PDF Info dictionary /Title as the document title", async () => {
    const objects = [
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 200 200] /Contents 5 0 R >>\nendobj\n",
      "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
      "5 0 obj\n<< /Length 30 >>\nstream\nBT /F1 18 Tf 10 100 Td (Hi) Tj ET\nendstream\nendobj\n",
      "6 0 obj\n<< /Title (My PDF Title) >>\nendobj\n",
    ];
    let pdf = "%PDF-1.4\n";
    const offsets: number[] = [];
    for (const obj of objects) {
      offsets.push(Buffer.byteLength(pdf, "latin1"));
      pdf += obj;
    }
    const xrefStart = Buffer.byteLength(pdf, "latin1");
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
    const bytes = new Uint8Array(Buffer.from(pdf, "latin1"));
    const doc = await pdfExtractor.extract(bufInput(bytes, "titled.pdf"), {});
    expect(doc.title).toBe("My PDF Title");
  });
});

describe("pptx extractor: speaker notes", () => {
  it("attaches speaker notes as section metadata", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide text</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    );
    zip.file(
      "ppt/notesSlides/notesSlide1.xml",
      `<?xml version="1.0"?><p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>These are speaker notes.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`,
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const doc = await pptxExtractor.extract(bufInput(bytes, "d.pptx"), {});
    expect(doc.sections[0]?.metadata?.speakerNotes).toContain("speaker notes");
  });
});

describe("xlsx extractor: cell value types", () => {
  it("handles a Date cell value", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    sheet.addRow(["when"]);
    sheet.addRow([new Date("2026-01-01T00:00:00.000Z")]);
    const buffer = await workbook.xlsx.writeBuffer();
    const doc = await xlsxExtractor.extract(
      bufInput(new Uint8Array(buffer as ArrayBuffer), "d.xlsx"),
      {},
    );
    expect(doc.sections[0]?.content).toContain("2026-01-01");
  });

  it("neutralizes a literal string cell value that looks like a formula", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    sheet.addRow(["value"]);
    sheet.addRow(["=SUM(A1:A2)"]);
    const buffer = await workbook.xlsx.writeBuffer();
    const doc = await xlsxExtractor.extract(
      bufInput(new Uint8Array(buffer as ArrayBuffer), "d.xlsx"),
      {},
    );
    expect(doc.sections[0]?.content).toContain("'=SUM(A1:A2)");
  });

  it("handles a rich-text cell value", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    sheet.addRow(["label"]);
    const row = sheet.addRow([]);
    row.getCell(1).value = { richText: [{ text: "bold " }, { text: "text" }] };
    const buffer = await workbook.xlsx.writeBuffer();
    const doc = await xlsxExtractor.extract(
      bufInput(new Uint8Array(buffer as ArrayBuffer), "d.xlsx"),
      {},
    );
    expect(doc.sections[0]?.content).toContain("bold text");
  });
});

describe("paths.ts: toPortablePath and SymlinkLoopGuard", () => {
  it("toPortablePath normalizes separators", () => {
    expect(toPortablePath("a/b/c")).toBe("a/b/c");
  });

  const canSymlink = (() => {
    try {
      const testDir = mkdtempSync(join(tmpdir(), "ulcs-loop-check-"));
      symlinkSync(testDir, join(testDir, "self"));
      rmSync(testDir, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!canSymlink)("detects revisiting the same real path as a loop", () => {
    const dir = mkdtempSync(join(tmpdir(), "ulcs-loop-real-"));
    const target = join(dir, "target.txt");
    writeFileSync(target, "x");
    const link1 = join(dir, "link1");
    const link2 = join(dir, "link2");
    symlinkSync(target, link1);
    symlinkSync(target, link2);
    const guard = new SymlinkLoopGuard();
    try {
      guard.check(link1);
      expect(() => guard.check(link2)).toThrow(); // same real target seen twice
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chunking/structured.ts: groupSections default branch", () => {
  it("groups everything under one key for a non-structural strategy", () => {
    const sections = [
      { id: "a", content: "x" },
      { id: "b", content: "y" },
    ];
    // "none" is not one of pages/slides/rows/sections — exercises the default branch.
    const groups = groupSections(sections, "none");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.sections).toHaveLength(2);
  });
});

describe("mapper.ts: objective and extra instruction", () => {
  function makeDoc(): ExtractedDocument {
    return {
      id: "doc:x",
      mediaType: "text/plain",
      contentHash: "x",
      byteLength: 10,
      extractedAt: new Date(0).toISOString(),
      sections: [
        { id: "s0", content: "Some content long enough to form a real chunk in this test." },
      ],
      metadata: {},
      warnings: [],
    };
  }

  it("adds an Objective item when options.objective is supplied", () => {
    const doc = makeDoc();
    const chunks = chunkDocument(doc, { strategy: "none" });
    const { envelope } = mapDocumentsToContext(
      { documents: [doc], chunksByDocumentId: new Map([[doc.id, chunks]]) },
      { objective: "Summarize the ingested content." },
    );
    expect(envelope.objective?.summary).toBe("Summarize the ingested content.");
  });

  it("adds an extra user instruction alongside the default one", () => {
    const doc = makeDoc();
    const chunks = chunkDocument(doc, { strategy: "none" });
    const { envelope } = mapDocumentsToContext(
      { documents: [doc], chunksByDocumentId: new Map([[doc.id, chunks]]) },
      { instruction: "Always cite the source filename." },
    );
    expect(envelope.instructions).toHaveLength(2);
    expect(
      envelope.instructions?.some((i) => i.content === "Always cite the source filename."),
    ).toBe(true);
    expect(
      envelope.instructions?.find((i) => i.content === "Always cite the source filename.")
        ?.authority,
    ).toBe("user");
  });
});
