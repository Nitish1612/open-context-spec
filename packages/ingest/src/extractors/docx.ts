import * as cheerio from "cheerio";
import type JSZip from "jszip";
import mammoth from "mammoth";
import { XMLParser } from "fast-xml-parser";
import { ExtractionError } from "../errors.js";
import { assertWithinCharLimit, resolveLimits } from "../security/limits.js";
import { inspectOfficeArchive } from "../security/officeArchive.js";
import type {
  ContentExtractor,
  ExtractedDocument,
  ExtractedSection,
  ExtractionOptions,
  ResolvedInput,
} from "../types.js";
import { buildExtractedDocument, warn } from "./util.js";

async function readCoreProperties(zip: JSZip): Promise<Record<string, unknown>> {
  try {
    const coreFile = zip.file("docProps/core.xml");
    if (!coreFile) return {};
    const xml = await coreFile.async("string");
    const parser = new XMLParser({ ignoreAttributes: true, textNodeName: "#text" });
    const parsed = parser.parse(xml) as Record<string, unknown>;
    const coreProps = (parsed["cp:coreProperties"] ?? parsed["coreProperties"]) as
      Record<string, unknown> | undefined;
    if (!coreProps) return {};
    return {
      title: coreProps["dc:title"],
      creator: coreProps["dc:creator"],
      created: coreProps["dcterms:created"],
      modified: coreProps["dcterms:modified"],
      lastModifiedBy: coreProps["cp:lastModifiedBy"],
    };
  } catch {
    return {};
  }
}

export const docxExtractor: ContentExtractor = {
  id: "docx",
  name: "Word document (DOCX)",
  extensions: [".docx"],
  mediaTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],

  supports(input) {
    return (
      input.mediaType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      /\.docx$/i.test(input.filename ?? "")
    );
  },

  async extract(input: ResolvedInput, options: ExtractionOptions): Promise<ExtractedDocument> {
    const limits = resolveLimits(options.limits);
    if (!input.data) throw new ExtractionError("DOCX extractor requires resolved byte content.");

    // Preflight the archive's central directory (entry count, total
    // uncompressed size, per-entry compression ratio, entry-name safety,
    // required OOXML structure) before decompressing any entry content.
    const { zip } = await inspectOfficeArchive(input.data, limits);

    // mammoth reads only document.xml/styles/numbering — it never executes
    // macros (VBA project parts) or opens embedded OLE objects; it simply
    // ignores parts it doesn't understand.
    const warnings = [];
    let html = "";
    try {
      const result = await mammoth.convertToHtml({ buffer: Buffer.from(input.data) });
      html = result.value;
      for (const message of result.messages) {
        if (message.type === "warning") {
          warnings.push(warn("partial-extraction", message.message));
        }
      }
    } catch (error) {
      throw new ExtractionError(
        `Failed to extract DOCX content: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }

    assertWithinCharLimit(html.length, limits.maxExtractedChars * 2, "Extracted DOCX HTML");

    const $ = cheerio.load(html);
    const sections: ExtractedSection[] = [];
    let currentHeading: string | undefined;
    let currentLevel = 0;
    let buffer: string[] = [];
    let sectionIndex = 0;

    const flush = () => {
      const body = buffer.join("\n\n").trim();
      const content = currentHeading ? [currentHeading, body].filter(Boolean).join("\n\n") : body;
      if (content.length > 0) {
        sections.push({
          id: `section:${sectionIndex++}`,
          title: currentHeading,
          section: currentHeading,
          content,
          metadata: { headingLevel: currentLevel },
        });
      }
      buffer = [];
    };

    $("body")
      .children()
      .each((_, el) => {
        const $el = $(el);
        const tag = (el as { tagName?: string }).tagName?.toLowerCase();
        if (tag && /^h[1-6]$/.test(tag)) {
          flush();
          currentHeading = $el.text().trim();
          currentLevel = Number(tag[1]);
          return;
        }
        if (tag === "table") {
          const rows: string[] = [];
          $el.find("tr").each((__, tr) => {
            const cells: string[] = [];
            $(tr)
              .find("th,td")
              .each((___, cell) => {
                cells.push($(cell).text().trim());
              });
            if (cells.length > 0) rows.push(cells.join(" | "));
          });
          if (rows.length > 0) buffer.push(rows.join("\n"));
          return;
        }
        if (tag === "ul" || tag === "ol") {
          $el.find("li").each((__, li) => {
            const value = $(li).text().trim();
            if (value) buffer.push(`- ${value}`);
          });
          return;
        }
        const value = $el.text().trim();
        if (value) buffer.push(value);
      });
    flush();

    const coreProps = await readCoreProperties(zip);
    const title =
      typeof coreProps.title === "string" && coreProps.title.trim() ? coreProps.title : undefined;

    if (sections.length === 0) {
      warnings.push(warn("empty-content", "No extractable text found in this DOCX document."));
    }

    return buildExtractedDocument({
      input,
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      data: input.data,
      title,
      sections,
      metadata: coreProps,
      warnings,
      extractedAt: new Date().toISOString(),
    });
  },
};
