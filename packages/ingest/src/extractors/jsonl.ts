import { ExtractionError } from "../errors.js";
import { assertWithinCharLimit, assertWithinCount, resolveLimits } from "../security/limits.js";
import type {
  ContentExtractor,
  ExtractedDocument,
  ExtractedSection,
  ExtractionOptions,
  ResolvedInput,
} from "../types.js";
import { buildExtractedDocument, decodeTextSafely, warn } from "./util.js";

export const jsonlExtractor: ContentExtractor = {
  id: "jsonl",
  name: "JSON Lines",
  extensions: [".jsonl", ".ndjson"],
  mediaTypes: ["application/x-ndjson"],

  supports(input) {
    return (
      input.mediaType === "application/x-ndjson" || /\.(jsonl|ndjson)$/i.test(input.filename ?? "")
    );
  },

  async extract(input: ResolvedInput, options: ExtractionOptions): Promise<ExtractedDocument> {
    const limits = resolveLimits(options.limits);
    if (!input.data) throw new ExtractionError("JSONL extractor requires resolved byte content.");

    const { text, hadInvalidSequences } = decodeTextSafely(input.data, {
      tolerant: options.tolerantTextDecoding,
      maxInvalidSequenceRatio: options.maxInvalidSequenceRatio,
    });
    assertWithinCharLimit(text.length, limits.maxExtractedChars, "Extracted text");

    const lines = text.split(/\r\n|\r|\n/);
    const sections: ExtractedSection[] = [];
    const warnings = [];
    let recordIndex = 0;

    lines.forEach((rawLine, lineNumber) => {
      const line = rawLine.trim();
      if (line.length === 0) return;
      try {
        const value: unknown = JSON.parse(line);
        sections.push({
          id: `section:${recordIndex}`,
          section: `record[${recordIndex}]`,
          content: JSON.stringify(value, null, 2),
          metadata: { recordIndex, lineNumber: lineNumber + 1 },
        });
        recordIndex++;
      } catch (error) {
        warnings.push(
          warn(
            "malformed-content",
            `Skipped invalid JSON on line ${lineNumber + 1}: ${error instanceof Error ? error.message : String(error)}`,
            {
              lineNumber: lineNumber + 1,
            },
          ),
        );
      }
    });

    assertWithinCount(sections.length, limits.maxSections, "JSONL record count");

    if (hadInvalidSequences) {
      warnings.push(
        warn(
          "malformed-content",
          "Input contained invalid UTF-8 byte sequences; they were replaced.",
        ),
      );
    }
    if (sections.length === 0) {
      warnings.push(warn("empty-content", "JSONL document produced no valid records."));
    }

    return buildExtractedDocument({
      input,
      mediaType: "application/x-ndjson",
      data: input.data,
      sections,
      metadata: { recordCount: sections.length },
      warnings,
      extractedAt: new Date().toISOString(),
    });
  },
};
