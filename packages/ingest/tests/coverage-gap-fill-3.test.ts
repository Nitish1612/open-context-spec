import { describe, expect, it } from "vitest";
import {
  markdownExtractor,
  jsonExtractor,
  pptxExtractor,
  csvExtractor,
  docxExtractor,
  htmlExtractor,
} from "../src/index.js";
import type { ResolvedInput } from "../src/index.js";
import JSZip from "jszip";

function bufInput(data: Uint8Array, filename: string): ResolvedInput {
  return { source: { kind: "buffer", data, filename }, data, filename };
}

describe("markdown extractor: remaining branches", () => {
  it("warns on invalid UTF-8 byte sequences", async () => {
    const invalid = new Uint8Array([0x23, 0x20, 0xff, 0xfe, 0x0a]); // "# " + invalid bytes
    const doc = await markdownExtractor.extract(bufInput(invalid, "bad.md"), {});
    expect(doc.warnings.some((w) => w.code === "malformed-content")).toBe(true);
  });

  it("warns on an all-whitespace document", async () => {
    const whitespace = new TextEncoder().encode("   \n\n   \n");
    const doc = await markdownExtractor.extract(bufInput(whitespace, "blank.md"), {});
    expect(doc.warnings.some((w) => w.code === "empty-content")).toBe(true);
  });
});

describe("json extractor: invalid UTF-8 warning", () => {
  it("warns on invalid UTF-8 byte sequences while still parsing valid JSON text", async () => {
    const jsonText = '{"a":1}';
    const invalid = new Uint8Array([...new TextEncoder().encode(jsonText), 0xff, 0xfe]);
    // Appending invalid trailing bytes after valid JSON would break parsing,
    // so instead embed invalid bytes inside a string value's raw bytes.
    const withInvalidInString = new Uint8Array([
      ...new TextEncoder().encode('{"a":"'),
      0xff,
      0xfe,
      ...new TextEncoder().encode('"}'),
    ]);
    void invalid;
    const doc = await jsonExtractor.extract(
      {
        source: { kind: "buffer", data: withInvalidInString, filename: "d.json" },
        data: withInvalidInString,
        filename: "d.json",
      },
      {},
    );
    expect(doc.warnings.some((w) => w.code === "malformed-content")).toBe(true);
  });
});

describe("csv extractor: invalid UTF-8 warning", () => {
  it("warns on invalid UTF-8 byte sequences", async () => {
    const invalid = new Uint8Array([...new TextEncoder().encode("a,b\n1,"), 0xff, 0xfe, 0x0a]);
    const doc = await csvExtractor.extract(bufInput(invalid, "bad.csv"), {});
    expect(doc.warnings.some((w) => w.code === "malformed-content")).toBe(true);
  });
});

describe("html extractor: invalid UTF-8 warning", () => {
  it("warns on invalid UTF-8 byte sequences", async () => {
    const invalid = new Uint8Array([
      ...new TextEncoder().encode("<p>hi "),
      0xff,
      0xfe,
      ...new TextEncoder().encode("</p>"),
    ]);
    const doc = await htmlExtractor.extract(bufInput(invalid, "bad.html"), {});
    expect(doc.warnings.some((w) => w.code === "malformed-content")).toBe(true);
  });

  it("handles a document with no <title>", async () => {
    const doc = await htmlExtractor.extract(
      bufInput(new TextEncoder().encode("<p>no title here</p>"), "d.html"),
      {},
    );
    expect(doc.title).toBeUndefined();
  });
});

describe("pptx extractor: title inference edge case", () => {
  it("does not set a presentation title when slide 1 has no title placeholder", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Body without title placeholder</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const doc = await pptxExtractor.extract(bufInput(bytes, "d.pptx"), {});
    expect(doc.title).toBeUndefined();
    expect(doc.sections[0]?.content).toContain("Body without title placeholder");
  });
});

describe("docx extractor: mammoth warning surfacing", () => {
  it("surfaces a mammoth warning for an unrecognized/undefined style reference", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="SomeUndefinedStyle"/></w:pPr><w:r><w:t>Styled text.</w:t></w:r></w:p></w:body></w:document>`,
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const doc = await docxExtractor.extract(bufInput(bytes, "d.docx"), {});
    expect(doc.warnings.some((w) => w.code === "partial-extraction")).toBe(true);
  });
});
