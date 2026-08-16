import { describe, expect, it } from "vitest";
import {
  jsonlExtractor,
  xlsxExtractor,
  pdfExtractor,
  SecurityRejectionError,
} from "../src/index.js";
import type { ResolvedInput } from "../src/index.js";
import ExcelJS from "exceljs";

function textInput(content: string, filename: string): ResolvedInput {
  return { source: { kind: "text", content }, data: new TextEncoder().encode(content), filename };
}
function bufInput(data: Uint8Array, filename: string): ResolvedInput {
  return { source: { kind: "buffer", data, filename }, data, filename };
}

describe("jsonl extractor: maxSections enforcement", () => {
  it("rejects a file with more records than maxSections", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => JSON.stringify({ i })).join("\n");
    await expect(
      jsonlExtractor.extract(textInput(lines, "d.jsonl"), { limits: { maxSections: 3 } }),
    ).rejects.toThrow(SecurityRejectionError);
  });
});

describe("xlsx extractor: row batching and limits", () => {
  it("splits many rows into multiple row-batched sections", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Big");
    sheet.addRow(["id"]);
    for (let i = 0; i < 120; i++) sheet.addRow([i]);
    const buffer = await workbook.xlsx.writeBuffer();
    const doc = await xlsxExtractor.extract(
      bufInput(new Uint8Array(buffer as ArrayBuffer), "d.xlsx"),
      {},
    );
    expect(doc.sections.length).toBeGreaterThan(1);
  });

  it("stops early and warns once the maxRows limit is reached across sheets", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet1 = workbook.addWorksheet("One");
    sheet1.addRow(["id"]);
    for (let i = 0; i < 10; i++) sheet1.addRow([i]);
    const sheet2 = workbook.addWorksheet("Two");
    sheet2.addRow(["id"]);
    for (let i = 0; i < 10; i++) sheet2.addRow([i]);
    const buffer = await workbook.xlsx.writeBuffer();
    const doc = await xlsxExtractor.extract(
      bufInput(new Uint8Array(buffer as ArrayBuffer), "d.xlsx"),
      {
        limits: { maxRows: 5 },
      },
    );
    expect(doc.warnings.some((w) => w.code === "truncated")).toBe(true);
  });

  it("handles a workbook with zero worksheets", async () => {
    const workbook = new ExcelJS.Workbook();
    const buffer = await workbook.xlsx.writeBuffer();
    const doc = await xlsxExtractor.extract(
      bufInput(new Uint8Array(buffer as ArrayBuffer), "empty.xlsx"),
      {},
    );
    expect(doc.sections).toHaveLength(0);
    expect(doc.warnings.some((w) => w.code === "empty-content")).toBe(true);
  });
});

describe("pdf extractor: multi-page and metadata", () => {
  function multiPagePdf(): Uint8Array {
    const objects = [
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>\nendobj\n",
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 200 200] /Contents 5 0 R >>\nendobj\n",
      "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
      "5 0 obj\n<< /Length 40 >>\nstream\nBT /F1 18 Tf 10 100 Td (Page One) Tj ET\nendstream\nendobj\n",
      "6 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 200 200] /Contents 7 0 R >>\nendobj\n",
      "7 0 obj\n<< /Length 40 >>\nstream\nBT /F1 18 Tf 10 100 Td (Page Two) Tj ET\nendstream\nendobj\n",
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
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
    return new Uint8Array(Buffer.from(pdf, "latin1"));
  }

  it("extracts text from every page with correct page numbers", async () => {
    const doc = await pdfExtractor.extract(bufInput(multiPagePdf(), "multi.pdf"), {});
    expect(doc.sections).toHaveLength(2);
    expect(doc.sections[0]?.page).toBe(1);
    expect(doc.sections[0]?.content).toContain("Page One");
    expect(doc.sections[1]?.page).toBe(2);
    expect(doc.sections[1]?.content).toContain("Page Two");
  });

  it("enforces the maxPages limit", async () => {
    await expect(
      pdfExtractor.extract(bufInput(multiPagePdf(), "multi.pdf"), { limits: { maxPages: 1 } }),
    ).rejects.toThrow(SecurityRejectionError);
  });
});
