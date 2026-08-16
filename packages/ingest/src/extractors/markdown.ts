import { ExtractionError } from "../errors.js";
import { assertWithinCharLimit, resolveLimits } from "../security/limits.js";
import type {
  ContentExtractor,
  ExtractedDocument,
  ExtractedSection,
  ExtractionOptions,
  ResolvedInput,
} from "../types.js";
import { buildExtractedDocument, decodeUtf8Strict, warn } from "./util.js";

interface HeadingSplit {
  title?: string;
  level: number;
  lines: string[];
}

/**
 * Splits Markdown into sections at ATX headings (`#`..`######`), while
 * never treating a `#` inside a fenced code block (``` or ~~~) as a
 * heading — code blocks are preserved verbatim within their section.
 */
function splitMarkdownSections(text: string): HeadingSplit[] {
  const lines = text.split(/\r\n|\r|\n/);
  const sections: HeadingSplit[] = [{ level: 0, lines: [] }];
  let inFence = false;
  let fenceMarker = "";

  for (const line of lines) {
    const fenceMatch = /^(```+|~~~+)/.exec(line.trim());
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fenceMatch[1] ?? "```";
      } else if (line.trim().startsWith(fenceMarker)) {
        inFence = false;
      }
      sections[sections.length - 1]?.lines.push(line);
      continue;
    }

    if (!inFence) {
      const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
      if (headingMatch) {
        sections.push({
          title: headingMatch[2]?.trim(),
          level: headingMatch[1]?.length ?? 1,
          lines: [line],
        });
        continue;
      }
    }
    sections[sections.length - 1]?.lines.push(line);
  }

  return sections.filter((s) => s.lines.some((l) => l.trim().length > 0));
}

export const markdownExtractor: ContentExtractor = {
  id: "markdown",
  name: "Markdown",
  extensions: [".md", ".markdown"],
  mediaTypes: ["text/markdown"],

  supports(input) {
    return input.mediaType === "text/markdown" || /\.(md|markdown)$/i.test(input.filename ?? "");
  },

  async extract(input: ResolvedInput, options: ExtractionOptions): Promise<ExtractedDocument> {
    const limits = resolveLimits(options.limits);
    if (!input.data)
      throw new ExtractionError("Markdown extractor requires resolved byte content.");

    const { text, hadInvalidSequences } = decodeUtf8Strict(input.data);
    assertWithinCharLimit(text.length, limits.maxExtractedChars, "Extracted text");

    const splits = splitMarkdownSections(text);
    const sections: ExtractedSection[] = splits.map((split, index) => ({
      id: `section:${index}`,
      title: split.title,
      section: split.title,
      content: split.lines.join("\n").trim(),
      metadata: { headingLevel: split.level },
    }));

    const warnings = [];
    if (hadInvalidSequences) {
      warnings.push(
        warn(
          "malformed-content",
          "Input contained invalid UTF-8 byte sequences; they were replaced.",
        ),
      );
    }
    if (sections.length === 0) {
      warnings.push(warn("empty-content", "Extracted markdown is empty."));
    }

    const title = splits.find((s) => s.level === 1)?.title;

    return buildExtractedDocument({
      input,
      mediaType: "text/markdown",
      data: input.data,
      title,
      sections: sections.length > 0 ? sections : [{ id: "section:0", content: text }],
      warnings,
      extractedAt: new Date().toISOString(),
    });
  },
};
