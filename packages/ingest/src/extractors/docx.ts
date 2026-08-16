import * as cheerio from "cheerio";
import JSZip from "jszip";
import mammoth from "mammoth";
import { XMLParser } from "fast-xml-parser";
import { ExtractionError } from "../errors.js";
import { assertSafeArchive, assertWithinCharLimit, resolveLimits } from "../security/limits.js";
import type {
  ContentExtractor,
  ExtractedDocument,
  ExtractedSection,
  ExtractionOptions,
  ResolvedInput,
} from "../types.js";
import { buildExtractedDocument, warn } from "./util.js";

async function readCoreProperties(data: Uint8Array): Promise<Record<string, unknown>> {
  try {
    const zip = await JSZip.loadAsync(data);
    const entries = Object.values(zip.files).map((f) => ({
      name: f.name,
      compressedSize:
        (f as unknown as { _data?: { compressedSize?: number } })._data?.compressedSize ?? 0,
      uncompressedSize:
        (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0,
    }));
    // Archive safety validated by caller before this is invoked; re-reading
    // here would double-count, so this function focuses purely on metadata.
    const coreFile = zip.file("docProps/core.xml");
    if (!coreFile) return {};
    const xml = await coreFile.async("string");
    const parser = new XMLParser({ ignoreAttributes: true, textNodeName: "#text" });
    const parsed = parser.parse(xml) as Record<string, unknown>;
    const coreProps = (parsed["cp:coreProperties"] ?? parsed["coreProperties"]) as
      Record<string, unknown> | undefined;
    if (!coreProps) return {};
    void entries;
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

    const zip = await JSZip.loadAsync(input.data).catch((error: unknown) => {
      throw new ExtractionError(
        `Failed to open DOCX as a zip archive (malformed container): ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    });
    const entries = Object.values(zip.files)
      .filter((f) => !f.dir)
      .map((f) => {
        const meta = (
          f as unknown as { _data?: { compressedSize?: number; uncompressedSize?: number } }
        )._data;
        return {
          name: f.name,
          compressedSize: meta?.compressedSize ?? 0,
          uncompressedSize: meta?.uncompressedSize ?? 0,
        };
      });
    assertSafeArchive(entries, limits);

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

    const coreProps = await readCoreProperties(input.data);
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
