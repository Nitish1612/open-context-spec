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

/** Computes a 1-based line/column from a character offset, for JSON parse-error diagnostics. */
function lineColAt(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

function parseJsonWithDiagnostics(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const positionMatch = /position (\d+)/.exec(message);
    if (positionMatch?.[1]) {
      const offset = Number(positionMatch[1]);
      const { line, column } = lineColAt(text, offset);
      throw new ExtractionError(
        `Invalid JSON at line ${line}, column ${column}: ${message}`,
        error,
        {
          line,
          column,
          offset,
        },
      );
    }
    throw new ExtractionError(`Invalid JSON: ${message}`, error);
  }
}

function stringifySection(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export const jsonExtractor: ContentExtractor = {
  id: "json",
  name: "JSON",
  extensions: [".json"],
  mediaTypes: ["application/json"],

  supports(input) {
    return input.mediaType === "application/json" || /\.json$/i.test(input.filename ?? "");
  },

  async extract(input: ResolvedInput, options: ExtractionOptions): Promise<ExtractedDocument> {
    const limits = resolveLimits(options.limits);
    if (!input.data) throw new ExtractionError("JSON extractor requires resolved byte content.");

    const { text, hadInvalidSequences } = decodeTextSafely(input.data, {
      tolerant: options.tolerantTextDecoding,
      maxInvalidSequenceRatio: options.maxInvalidSequenceRatio,
    });
    assertWithinCharLimit(text.length, limits.maxExtractedChars, "Extracted text");

    const parsed = parseJsonWithDiagnostics(text);
    const sections: ExtractedSection[] = [];
    const warnings = [];

    if (Array.isArray(parsed)) {
      assertWithinCount(parsed.length, limits.maxSections, "JSON array element count");
      parsed.forEach((element, index) => {
        sections.push({
          id: `section:${index}`,
          section: `$[${index}]`,
          content: stringifySection(element),
          metadata: { path: `$[${index}]`, index },
        });
      });
    } else if (parsed !== null && typeof parsed === "object") {
      const entries = Object.entries(parsed as Record<string, unknown>);
      assertWithinCount(entries.length, limits.maxSections, "JSON top-level key count");
      entries.forEach(([key, value], index) => {
        sections.push({
          id: `section:${index}`,
          title: key,
          section: `$.${key}`,
          content: stringifySection(value),
          metadata: { path: `$.${key}` },
        });
      });
    } else {
      sections.push({ id: "section:0", section: "$", content: stringifySection(parsed) });
    }

    if (hadInvalidSequences) {
      warnings.push(
        warn(
          "malformed-content",
          "Input contained invalid UTF-8 byte sequences; they were replaced.",
        ),
      );
    }
    if (sections.length === 0) {
      warnings.push(warn("empty-content", "JSON document produced no sections."));
    }

    return buildExtractedDocument({
      input,
      mediaType: "application/json",
      data: input.data,
      sections,
      metadata: { topLevelType: Array.isArray(parsed) ? "array" : typeof parsed },
      warnings,
      extractedAt: new Date().toISOString(),
    });
  },
};
