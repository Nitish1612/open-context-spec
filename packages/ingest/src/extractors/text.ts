import { ExtractionError } from "../errors.js";
import { assertWithinCharLimit } from "../security/limits.js";
import { resolveLimits } from "../security/limits.js";
import type {
  ContentExtractor,
  ExtractedDocument,
  ExtractionOptions,
  ResolvedInput,
} from "../types.js";
import { buildExtractedDocument, decodeUtf8Strict, warn } from "./util.js";

export const textExtractor: ContentExtractor = {
  id: "text",
  name: "Plain text",
  extensions: [".txt", ".text", ".log"],
  mediaTypes: ["text/plain"],

  supports(input) {
    return input.mediaType === "text/plain" || (input.filename ?? "").endsWith(".txt");
  },

  async extract(input: ResolvedInput, options: ExtractionOptions): Promise<ExtractedDocument> {
    const limits = resolveLimits(options.limits);
    if (!input.data) throw new ExtractionError("Text extractor requires resolved byte content.");

    const { text, hadInvalidSequences } = decodeUtf8Strict(input.data);
    assertWithinCharLimit(text.length, limits.maxExtractedChars, "Extracted text");

    const warnings = [];
    if (hadInvalidSequences) {
      warnings.push(
        warn(
          "malformed-content",
          "Input contained invalid UTF-8 byte sequences; they were replaced.",
          {
            filename: input.filename,
          },
        ),
      );
    }
    if (text.trim().length === 0) {
      warnings.push(warn("empty-content", "Extracted text is empty."));
    }

    return buildExtractedDocument({
      input,
      mediaType: "text/plain",
      data: input.data,
      sections: [
        {
          id: "section:0",
          content: text,
        },
      ],
      warnings,
      extractedAt: new Date().toISOString(),
    });
  },
};
