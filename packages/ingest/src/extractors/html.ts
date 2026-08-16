import * as cheerio from "cheerio";
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

const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "object",
  "embed",
  "nav",
  "svg",
];

export const htmlExtractor: ContentExtractor = {
  id: "html",
  name: "HTML",
  extensions: [".html", ".htm"],
  mediaTypes: ["text/html"],

  supports(input) {
    return input.mediaType === "text/html" || /\.html?$/i.test(input.filename ?? "");
  },

  async extract(input: ResolvedInput, options: ExtractionOptions): Promise<ExtractedDocument> {
    const limits = resolveLimits(options.limits);
    if (!input.data) throw new ExtractionError("HTML extractor requires resolved byte content.");

    const { text, hadInvalidSequences } = decodeUtf8Strict(input.data);
    assertWithinCharLimit(text.length, limits.maxExtractedChars, "Extracted text");

    // cheerio parses markup only — it never executes <script> content or
    // any active content; NOISE_SELECTORS strips it regardless.
    const $ = cheerio.load(text);
    NOISE_SELECTORS.forEach((selector) => $(selector).remove());

    const title = $("title").first().text().trim() || undefined;
    const canonical = $('link[rel="canonical"]').attr("href");

    const sections: ExtractedSection[] = [];
    let currentHeading: string | undefined;
    let currentLevel = 0;
    let buffer: string[] = [];
    let sectionIndex = 0;

    const flush = () => {
      const body = buffer
        .join("\n\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
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

    // Search the whole document root rather than branching on whether a
    // <body> tag is present — fragments (no <html>/<body>) and full
    // documents are both handled uniformly this way.
    const body = $.root();
    body.find("h1,h2,h3,h4,h5,h6,p,li,table,pre,blockquote").each((_, el) => {
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
      const value = $el.text().trim();
      if (value) buffer.push(tag === "li" ? `- ${value}` : value);
    });
    flush();

    const links: string[] = [];
    body.find("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (href && !href.startsWith("javascript:")) links.push(href);
    });

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
      warnings.push(
        warn("empty-content", "No meaningful visible text found in the HTML document."),
      );
    }

    return buildExtractedDocument({
      input,
      mediaType: "text/html",
      data: input.data,
      title,
      sections,
      metadata: { canonicalUrl: canonical, links: links.slice(0, 500) },
      warnings,
      extractedAt: new Date().toISOString(),
    });
  },
};
