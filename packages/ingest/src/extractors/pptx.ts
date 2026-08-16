import JSZip from "jszip";
import { ExtractionError } from "../errors.js";
import { assertSafeArchive, assertWithinCount, resolveLimits } from "../security/limits.js";
import type {
  ContentExtractor,
  ExtractedDocument,
  ExtractedSection,
  ExtractionOptions,
  ResolvedInput,
} from "../types.js";
import { buildExtractedDocument, warn } from "./util.js";

/**
 * OOXML `<a:t>` runs never nest and always hold plain text, so extracting
 * them directly with a bounded regex over already zip-validated,
 * XML-well-formed slide parts is a safe, dependency-light way to pull text
 * without building a full DrawingML object model. Paragraph (`<a:p>`)
 * boundaries become line breaks.
 */
function paragraphsToLines(xmlFragment: string): string[] {
  const lines: string[] = [];
  const paraRegex = /<a:p[ >][\s\S]*?<\/a:p>/g;
  let match: RegExpExecArray | null;
  while ((match = paraRegex.exec(xmlFragment))) {
    const textRuns = [...match[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) =>
      decodeXmlEntities(m[1] ?? ""),
    );
    const line = textRuns.join("").trim();
    if (line.length > 0) lines.push(line);
  }
  return lines;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractShapeBlocks(slideXml: string): string[] {
  return [...slideXml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]);
}

function extractTitle(slideXml: string): string | undefined {
  for (const shape of extractShapeBlocks(slideXml)) {
    if (/<p:ph[^>]*type="(title|ctrTitle)"/.test(shape)) {
      const lines = paragraphsToLines(shape);
      if (lines.length > 0) return lines.join(" ").trim();
    }
  }
  return undefined;
}

function extractTables(slideXml: string): string[] {
  const tables: string[] = [];
  for (const tblMatch of slideXml.matchAll(/<a:tbl>[\s\S]*?<\/a:tbl>/g)) {
    const rows: string[] = [];
    for (const rowMatch of tblMatch[0].matchAll(/<a:tr[ >][\s\S]*?<\/a:tr>/g)) {
      const cells: string[] = [];
      for (const cellMatch of rowMatch[0].matchAll(/<a:tc[ >][\s\S]*?<\/a:tc>/g)) {
        const texts = [...cellMatch[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) =>
          decodeXmlEntities(m[1] ?? ""),
        );
        cells.push(texts.join("").trim());
      }
      if (cells.length > 0) rows.push(cells.join(" | "));
    }
    if (rows.length > 0) tables.push(rows.join("\n"));
  }
  return tables;
}

/** Sorts `ppt/slides/slideN.xml` entries by their numeric suffix, the conventional (though not schema-guaranteed) slide order. */
function slideSortKey(name: string): number {
  const match = /slide(\d+)\.xml$/.exec(name);
  return match?.[1] ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export const pptxExtractor: ContentExtractor = {
  id: "pptx",
  name: "PowerPoint presentation (PPTX)",
  extensions: [".pptx"],
  mediaTypes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],

  supports(input) {
    return (
      input.mediaType ===
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      /\.pptx$/i.test(input.filename ?? "")
    );
  },

  async extract(input: ResolvedInput, options: ExtractionOptions): Promise<ExtractedDocument> {
    const limits = resolveLimits(options.limits);
    if (!input.data) throw new ExtractionError("PPTX extractor requires resolved byte content.");

    const zip = await JSZip.loadAsync(input.data).catch((error: unknown) => {
      throw new ExtractionError(
        `Failed to open PPTX as a zip archive (malformed container): ${error instanceof Error ? error.message : String(error)}`,
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

    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => slideSortKey(a) - slideSortKey(b));

    assertWithinCount(slideFiles.length, limits.maxSlides, "PPTX slide count");

    const warnings = [];
    const sections: ExtractedSection[] = [];
    let sectionIndex = 0;
    let presentationTitle: string | undefined;

    for (let i = 0; i < slideFiles.length; i++) {
      const slideNumber = i + 1;
      const slideName = slideFiles[i] as string;
      const slideXml = await zip.file(slideName)!.async("string");

      const title = extractTitle(slideXml);
      if (slideNumber === 1 && title) presentationTitle = title;

      const bodyLines = paragraphsToLines(slideXml).filter((line) => line !== title);
      const tables = extractTables(slideXml);

      const contentParts = [...bodyLines, ...tables];
      if (contentParts.length === 0 && !title) {
        warnings.push(
          warn("empty-content", `Slide ${slideNumber} has no extractable text.`, {
            slide: slideNumber,
          }),
        );
      }
      if (/<p:graphicFrame>[\s\S]*?(a:chart|a:diagram|dgm:relIds)/.test(slideXml)) {
        warnings.push(
          warn(
            "unsupported-feature",
            `Slide ${slideNumber} contains a chart or diagram; only its text labels (if any) were extracted.`,
            {
              slide: slideNumber,
            },
          ),
        );
      }
      if (/<p:pic[\s/>]/.test(slideXml)) {
        warnings.push(
          warn(
            "unsupported-feature",
            `Slide ${slideNumber} contains an image; image content was not extracted.`,
            { slide: slideNumber },
          ),
        );
      }

      let notes: string | undefined;
      const notesName = `ppt/notesSlides/notesSlide${slideNumber}.xml`;
      const notesFile = zip.file(notesName);
      if (notesFile) {
        const notesXml = await notesFile.async("string");
        const notesLines = paragraphsToLines(notesXml);
        if (notesLines.length > 0) notes = notesLines.join("\n");
      }

      const content = [title, ...contentParts].filter(Boolean).join("\n\n").trim();
      if (content.length === 0 && !notes) continue;

      sections.push({
        id: `section:${sectionIndex++}`,
        slide: slideNumber,
        title,
        content: content || "(no slide text)",
        metadata: notes ? { speakerNotes: notes } : undefined,
      });
    }

    if (sections.length === 0) {
      warnings.push(warn("empty-content", "No extractable text found in this presentation."));
    }

    return buildExtractedDocument({
      input,
      mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      data: input.data,
      title: presentationTitle,
      sections,
      metadata: { slideCount: slideFiles.length },
      warnings,
      extractedAt: new Date().toISOString(),
    });
  },
};
