import { describe, expect, it } from "vitest";
import {
  jsonExtractor,
  jsonlExtractor,
  csvExtractor,
  markdownExtractor,
  xmlExtractor,
  pptxExtractor,
  xlsxExtractor,
  docxExtractor,
  textExtractor,
  ExtractionError,
  SecurityRejectionError,
} from "../src/index.js";
import type { ResolvedInput } from "../src/index.js";
import { minimalDocxBytes, minimalPptxBytes, minimalXlsxBytes } from "./fixtures.js";
import JSZip from "jszip";
import ExcelJS from "exceljs";

function bufInput(data: Uint8Array, filename: string): ResolvedInput {
  return { source: { kind: "buffer", data, filename }, data, filename };
}
function textInput(content: string, filename: string): ResolvedInput {
  const data = new TextEncoder().encode(content);
  return { source: { kind: "text", content }, data, filename };
}

describe("json extractor edge cases", () => {
  it("handles an empty top-level array", async () => {
    const doc = await jsonExtractor.extract(textInput("[]", "d.json"), {});
    expect(doc.sections).toHaveLength(0);
    expect(doc.warnings.some((w) => w.code === "empty-content")).toBe(true);
  });

  it("handles a top-level scalar", async () => {
    const doc = await jsonExtractor.extract(textInput("42", "d.json"), {});
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]?.content).toBe("42");
    expect(doc.metadata.topLevelType).toBe("number");
  });

  it("throws ExtractionError for JSON invalid at the very start (no position info)", async () => {
    await expect(jsonExtractor.extract(textInput("", "empty.json"), {})).rejects.toThrow(
      ExtractionError,
    );
  });
});

describe("jsonl extractor edge cases", () => {
  it("handles an entirely empty file", async () => {
    const doc = await jsonlExtractor.extract(textInput("", "d.jsonl"), {});
    expect(doc.sections).toHaveLength(0);
    expect(doc.warnings.some((w) => w.code === "empty-content")).toBe(true);
  });

  it("skips blank lines between records", async () => {
    const doc = await jsonlExtractor.extract(textInput('{"a":1}\n\n{"a":2}\n', "d.jsonl"), {});
    expect(doc.sections).toHaveLength(2);
  });
});

describe("csv extractor edge cases", () => {
  it("handles a header-only file with no data rows", async () => {
    const doc = await csvExtractor.extract(textInput("a,b\n", "d.csv"), {});
    expect(doc.sections).toHaveLength(0);
    expect(doc.metadata.headers).toEqual(["a", "b"]);
  });

  it("handles a completely empty file", async () => {
    const doc = await csvExtractor.extract(textInput("", "d.csv"), {});
    expect(doc.sections).toHaveLength(0);
    expect(doc.warnings.some((w) => w.code === "empty-content")).toBe(true);
  });
});

describe("markdown extractor edge cases", () => {
  it("uses the only h1 as the document title even with no body text", async () => {
    const doc = await markdownExtractor.extract(textInput("# Just A Title", "d.md"), {});
    expect(doc.title).toBe("Just A Title");
  });

  it("handles multiple headings at the same level", async () => {
    const md = "# One\n\nBody one.\n\n# Two\n\nBody two.\n";
    const doc = await markdownExtractor.extract(textInput(md, "d.md"), {});
    expect(doc.sections).toHaveLength(2);
  });
});

describe("xml extractor edge cases", () => {
  it("enforces the maxSections limit", async () => {
    const items = Array.from({ length: 10 }, (_, i) => `<item>value${i}</item>`).join("");
    const xml = `<root>${items}</root>`;
    await expect(
      xmlExtractor.extract(textInput(xml, "d.xml"), { limits: { maxSections: 3 } }),
    ).rejects.toThrow(SecurityRejectionError);
  });

  it("handles attributes without throwing", async () => {
    const xml = `<root><item id="1" active="true">Text</item></root>`;
    const doc = await xmlExtractor.extract(textInput(xml, "d.xml"), {});
    expect(doc.sections[0]?.content).toBe("Text");
  });
});

describe("text extractor edge cases", () => {
  it("rejects when no data is provided", async () => {
    await expect(
      textExtractor.extract({ source: { kind: "text", content: "" }, filename: "x.txt" }, {}),
    ).rejects.toThrow(ExtractionError);
  });
});

describe("pptx extractor edge cases", () => {
  it("warns about charts/diagrams and images without failing extraction", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld><p:spTree>
      <p:graphicFrame><a:chart/></p:graphicFrame>
      <p:pic/>
      </p:spTree></p:cSld></p:sld>`,
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const doc = await pptxExtractor.extract(bufInput(bytes, "d.pptx"), {});
    expect(doc.warnings.some((w) => w.message.includes("chart or diagram"))).toBe(true);
    expect(doc.warnings.some((w) => w.message.includes("image"))).toBe(true);
  });

  it("rejects a malformed (non-zip) pptx", async () => {
    const garbage = new TextEncoder().encode("not a pptx");
    await expect(pptxExtractor.extract(bufInput(garbage, "bad.pptx"), {})).rejects.toThrow();
  });

  it("enforces the maxSlides limit", async () => {
    const bytes = await minimalPptxBytes();
    await expect(
      pptxExtractor.extract(bufInput(bytes, "d.pptx"), { limits: { maxSlides: 0 } }),
    ).rejects.toThrow(SecurityRejectionError);
  });
});

describe("xlsx extractor edge cases", () => {
  it("flags an empty sheet (header row only) with a warning", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Empty");
    sheet.addRow(["a", "b"]);
    const buffer = await workbook.xlsx.writeBuffer();
    const doc = await xlsxExtractor.extract(
      bufInput(new Uint8Array(buffer as ArrayBuffer), "d.xlsx"),
      {},
    );
    expect(doc.warnings.some((w) => w.message.includes("no data rows"))).toBe(true);
  });

  it("extracts formula cells with both formula text and cached result", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    sheet.addRow(["a", "b", "sum"]);
    const row = sheet.addRow([1, 2, { formula: "A2+B2", result: 3 }]);
    void row;
    const buffer = await workbook.xlsx.writeBuffer();
    const doc = await xlsxExtractor.extract(
      bufInput(new Uint8Array(buffer as ArrayBuffer), "d.xlsx"),
      {},
    );
    expect(doc.sections[0]?.content).toContain("formula:");
  });

  it("rejects a malformed (non-zip) xlsx", async () => {
    const garbage = new TextEncoder().encode("not an xlsx");
    await expect(xlsxExtractor.extract(bufInput(garbage, "bad.xlsx"), {})).rejects.toThrow();
  });

  it("enforces the maxSheets limit", async () => {
    const bytes = await minimalXlsxBytes();
    await expect(
      xlsxExtractor.extract(bufInput(bytes, "d.xlsx"), { limits: { maxSheets: 0 } }),
    ).rejects.toThrow(SecurityRejectionError);
  });
});

describe("docx extractor edge cases", () => {
  it("extracts list items and table rows", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Item one</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      </w:body></w:document>`,
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const doc = await docxExtractor.extract(bufInput(bytes, "d.docx"), {});
    const allContent = doc.sections.map((s) => s.content).join("\n");
    expect(allContent).toContain("Item one");
    expect(allContent).toContain("Cell A");
    expect(allContent).toContain("Cell B");
  });

  it("has no title in metadata when core.xml is absent", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Body only.</w:t></w:r></w:p></w:body></w:document>`,
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const doc = await docxExtractor.extract(bufInput(bytes, "d.docx"), {});
    expect(doc.title).toBeUndefined();
  });
});

// Ensure the top-level fixture-based DOCX test still exercises the full path.
describe("docx extractor with the shared fixture", () => {
  it("round-trips through minimalDocxBytes without throwing", async () => {
    const bytes = await minimalDocxBytes();
    await expect(docxExtractor.extract(bufInput(bytes, "d.docx"), {})).resolves.toBeDefined();
  });
});
