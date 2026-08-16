import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  docxExtractor,
  pptxExtractor,
  xlsxExtractor,
  SecurityRejectionError,
  ExtractionError,
  safeJoin,
} from "../src/index.js";
import { inspectOfficeArchive } from "../src/security/officeArchive.js";
import type { ResolvedInput } from "../src/index.js";
import { resolveLimits } from "../src/index.js";
import { minimalDocxBytes, minimalPptxBytes, minimalXlsxBytes } from "./fixtures.js";
import ExcelJS from "exceljs";

function bufInput(data: Uint8Array, filename: string): ResolvedInput {
  return { source: { kind: "buffer", data, filename }, data, filename };
}

/** A minimal-but-otherwise-valid OOXML shell with one deliberately huge, highly-compressible entry (a compression-bomb shape) and a workbook.xml that would break ExcelJS if it were ever reached. */
async function xlsxCompressionBombBytes(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
  );
  // Deliberately broken — if ExcelJS ever got this far, it would throw a
  // parse error, not a SecurityRejectionError. Seeing SecurityRejectionError
  // instead proves our preflight intercepted before ExcelJS ran.
  zip.file("xl/workbook.xml", "<not-valid-workbook-xml");
  // 20MB of zeros compresses to a few KB — a huge ratio.
  zip.file("xl/worksheets/sheet1.xml", new Uint8Array(20 * 1024 * 1024), {
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
  return zip.generateAsync({ type: "uint8array" });
}

async function xlsxManyEntriesBytes(count: number): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
  );
  for (let i = 0; i < count; i++) zip.file(`junk/${i}.xml`, "x");
  return zip.generateAsync({ type: "uint8array" });
}

async function zipWithEntryName(name: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
  );
  zip.file(name, "malicious payload");
  return zip.generateAsync({ type: "uint8array" });
}

describe("Defect 5: XLSX archive is preflighted before ExcelJS decompresses it", () => {
  it("rejects a compression-bomb-shaped XLSX with SecurityRejectionError, never reaching ExcelJS", async () => {
    const bytes = await xlsxCompressionBombBytes();
    await expect(
      xlsxExtractor.extract(bufInput(bytes, "bomb.xlsx"), {
        limits: { maxCompressionRatio: 100, maxArchiveUncompressedBytes: 10 * 1024 * 1024 },
      }),
    ).rejects.toThrow(SecurityRejectionError);
  });

  it("rejects an XLSX with an excessive uncompressed total before decompression", async () => {
    const bytes = await xlsxCompressionBombBytes();
    await expect(
      xlsxExtractor.extract(bufInput(bytes, "bomb.xlsx"), {
        limits: { maxCompressionRatio: 1_000_000, maxArchiveUncompressedBytes: 1024 },
      }),
    ).rejects.toThrow(SecurityRejectionError);
  });

  it("rejects an XLSX with an excessive archive entry count", async () => {
    const bytes = await xlsxManyEntriesBytes(50);
    await expect(
      xlsxExtractor.extract(bufInput(bytes, "many.xlsx"), { limits: { maxArchiveEntries: 10 } }),
    ).rejects.toThrow(SecurityRejectionError);
  });

  it("rejects a malformed (non-zip) XLSX with a clear extraction error, not a crash", async () => {
    const garbage = new TextEncoder().encode("this is not a zip file at all");
    await expect(xlsxExtractor.extract(bufInput(garbage, "bad.xlsx"), {})).rejects.toThrow(
      ExtractionError,
    );
  });

  it("still extracts a normal, valid, small workbook correctly", async () => {
    const bytes = await minimalXlsxBytes();
    const doc = await xlsxExtractor.extract(bufInput(bytes, "ok.xlsx"), {});
    expect(doc.sections.length).toBeGreaterThan(0);
  });

  it("extracts a workbook containing formulas without evaluating them", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    sheet.addRow(["a", "b", "computed"]);
    sheet.addRow([2, 3, { formula: "A2*B2", result: 6 }]);
    const buffer = await workbook.xlsx.writeBuffer();
    const doc = await xlsxExtractor.extract(
      bufInput(new Uint8Array(buffer as ArrayBuffer), "formulas.xlsx"),
      {},
    );
    expect(doc.sections[0]?.content).toContain("formula: A2*B2");
    expect(doc.sections[0]?.content).toContain("6"); // the cached result, not a re-evaluated value
  });
});

describe("Defect 6: archive entry-name validation (shared across docx/pptx/xlsx)", () => {
  const maliciousNames = [
    ["Unix path traversal", "../../../etc/passwd"],
    ["Windows path traversal", "..\\..\\windows\\system32\\config"],
    ["absolute Unix path", "/etc/passwd"],
    ["Windows drive-letter path", "C:\\Windows\\System32\\evil.dll"],
    ["UNC path", "\\\\attacker.example\\share\\payload"],
    ["mixed separators traversal", "docs/../../secrets.txt"],
    ["NUL-byte name", "innocuous.txt\0.exe"],
  ] as const;

  for (const [label, name] of maliciousNames) {
    it(`rejects a ${label} archive entry name via inspectOfficeArchive`, async () => {
      const bytes = await zipWithEntryName(name);
      await expect(inspectOfficeArchive(bytes, resolveLimits())).rejects.toThrow(
        SecurityRejectionError,
      );
    });

    it(`docx extractor rejects a ${label} entry name`, async () => {
      const bytes = await zipWithEntryName(name);
      await expect(docxExtractor.extract(bufInput(bytes, "evil.docx"), {})).rejects.toThrow(
        SecurityRejectionError,
      );
    });

    it(`pptx extractor rejects a ${label} entry name`, async () => {
      const bytes = await zipWithEntryName(name);
      await expect(pptxExtractor.extract(bufInput(bytes, "evil.pptx"), {})).rejects.toThrow(
        SecurityRejectionError,
      );
    });

    it(`xlsx extractor rejects a ${label} entry name`, async () => {
      const bytes = await zipWithEntryName(name);
      await expect(xlsxExtractor.extract(bufInput(bytes, "evil.xlsx"), {})).rejects.toThrow(
        SecurityRejectionError,
      );
    });
  }

  it("rejects an archive missing the required [Content_Types].xml structure", async () => {
    const zip = new JSZip();
    zip.file("random.xml", "not an office document");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(inspectOfficeArchive(bytes, resolveLimits())).rejects.toThrow(ExtractionError);
  });

  it("normal documents with ordinary nested paths still extract correctly", async () => {
    const docxBytes = await minimalDocxBytes();
    const pptxBytes = await minimalPptxBytes();
    await expect(docxExtractor.extract(bufInput(docxBytes, "ok.docx"), {})).resolves.toBeDefined();
    await expect(pptxExtractor.extract(bufInput(pptxBytes, "ok.pptx"), {})).resolves.toBeDefined();
  });
});

describe("Defect 6: safeJoin has a documented, legitimate use case (not falsely claimed as used for in-memory extraction)", () => {
  it("is still exported as a utility for extractors/callers that materialize archive entries to disk", () => {
    expect(() => safeJoin("/base/dir", "sub/entry.txt")).not.toThrow();
    expect(() => safeJoin("/base/dir", "../escape.txt")).toThrow(SecurityRejectionError);
  });
});
