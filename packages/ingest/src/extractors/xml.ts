import { XMLParser } from "fast-xml-parser";
import { ExtractionError, SecurityRejectionError } from "../errors.js";
import { assertWithinCharLimit, assertWithinCount, resolveLimits } from "../security/limits.js";
import type {
  ContentExtractor,
  ExtractedDocument,
  ExtractedSection,
  ExtractionOptions,
  ResolvedInput,
} from "../types.js";
import { buildExtractedDocument, decodeTextSafely, warn } from "./util.js";

/**
 * `fast-xml-parser` never fetches or resolves DTDs (no `SYSTEM`/`PUBLIC`
 * external entity support at all — it only expands the five predefined XML
 * entities), so it isn't vulnerable to XXE or classic entity-expansion
 * ("billion laughs") attacks by construction. This check is defense in
 * depth: it rejects any DOCTYPE declaring an external subset outright,
 * rather than relying solely on the parser's non-support.
 */
function assertNoExternalDoctype(text: string): void {
  const doctypeMatch = /<!DOCTYPE[^>]*>/is.exec(text);
  if (!doctypeMatch) return;
  const declaration = doctypeMatch[0];
  if (
    /\bSYSTEM\b/i.test(declaration) ||
    /\bPUBLIC\b/i.test(declaration) ||
    /<!ENTITY/i.test(declaration)
  ) {
    throw new SecurityRejectionError(
      "Rejected XML document: DOCTYPE declares an external subset or custom entity (possible XXE / entity-expansion attempt).",
      {},
    );
  }
}

interface XmlNode {
  tag: string;
  path: string;
  text: string;
  children: XmlNode[];
}

function walk(value: unknown, tag: string, path: string): XmlNode {
  const children: XmlNode[] = [];
  let text = "";
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "#text") {
        text = String(child);
        continue;
      }
      if (key.startsWith("@_")) continue;
      const childValues = Array.isArray(child) ? child : [child];
      childValues.forEach((cv, index) => {
        const childPath = childValues.length > 1 ? `${path}/${key}[${index}]` : `${path}/${key}`;
        children.push(walk(cv, key, childPath));
      });
    }
  } else {
    text = String(value ?? "");
  }
  return { tag, path, text, children };
}

function flattenToSections(
  node: XmlNode,
  sections: ExtractedSection[],
  limits: { maxSections: number },
): void {
  const directText = node.text.trim();
  if (directText.length > 0) {
    sections.push({
      id: `section:${sections.length}`,
      section: node.path,
      content: directText,
      metadata: { path: node.path, tag: node.tag },
    });
    // Fail fast rather than silently truncating: for a maliciously large
    // document this bails out well before building the full section list.
    assertWithinCount(sections.length, limits.maxSections, "XML section count");
  }
  for (const child of node.children) {
    flattenToSections(child, sections, limits);
  }
}

export const xmlExtractor: ContentExtractor = {
  id: "xml",
  name: "XML",
  extensions: [".xml"],
  mediaTypes: ["application/xml", "text/xml"],

  supports(input) {
    return (
      input.mediaType === "application/xml" ||
      input.mediaType === "text/xml" ||
      /\.xml$/i.test(input.filename ?? "")
    );
  },

  async extract(input: ResolvedInput, options: ExtractionOptions): Promise<ExtractedDocument> {
    const limits = resolveLimits(options.limits);
    if (!input.data) throw new ExtractionError("XML extractor requires resolved byte content.");

    const { text, hadInvalidSequences } = decodeTextSafely(input.data, {
      tolerant: options.tolerantTextDecoding,
      maxInvalidSequenceRatio: options.maxInvalidSequenceRatio,
    });
    assertWithinCharLimit(text.length, limits.maxExtractedChars, "Extracted text");
    assertNoExternalDoctype(text);

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "#text",
      trimValues: true,
      processEntities: true,
      stopNodes: [],
    });

    let parsed: unknown;
    try {
      parsed = parser.parse(text);
    } catch (error) {
      throw new ExtractionError(
        `Invalid XML: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }

    const rootKey =
      Object.keys(parsed as Record<string, unknown>).find((k) => k !== "?xml") ?? "root";
    const rootNode = walk((parsed as Record<string, unknown>)[rootKey], rootKey, `/${rootKey}`);

    const sections: ExtractedSection[] = [];
    flattenToSections(rootNode, sections, limits);
    assertWithinCount(sections.length, limits.maxSections, "XML section count");

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
      warnings.push(warn("empty-content", "XML document produced no text content."));
    }

    return buildExtractedDocument({
      input,
      mediaType: "application/xml",
      data: input.data,
      title: rootKey,
      sections,
      metadata: { rootElement: rootKey },
      warnings,
      extractedAt: new Date().toISOString(),
    });
  },
};
