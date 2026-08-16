import { extractText, getDocumentProxy, getMeta, renderPageAsImage } from "unpdf";
import { CapabilityUnavailableError, ExtractionError } from "../errors.js";
import { assertWithinCharLimit, assertWithinCount, resolveLimits } from "../security/limits.js";
import type {
  ContentExtractor,
  ExtractedDocument,
  ExtractedSection,
  ExtractionOptions,
  ResolvedInput,
} from "../types.js";
import { buildExtractedDocument, warn } from "./util.js";

/** A page whose extracted text is empty is treated as image-only/scanned. */
const MIN_PAGE_TEXT_LENGTH = 1;

export const pdfExtractor: ContentExtractor = {
  id: "pdf",
  name: "PDF",
  extensions: [".pdf"],
  mediaTypes: ["application/pdf"],

  supports(input) {
    return input.mediaType === "application/pdf" || /\.pdf$/i.test(input.filename ?? "");
  },

  async extract(input: ResolvedInput, options: ExtractionOptions): Promise<ExtractedDocument> {
    const limits = resolveLimits(options.limits);
    if (!input.data) throw new ExtractionError("PDF extractor requires resolved byte content.");

    let proxy;
    try {
      proxy = await getDocumentProxy(input.data);
    } catch (error) {
      throw new ExtractionError(
        `Failed to parse PDF: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }

    assertWithinCount(proxy.numPages, limits.maxPages, "PDF page count");

    const { totalPages, text } = await extractText(proxy, { mergePages: false });
    const pages = Array.isArray(text) ? text : [text];

    const warnings = [];
    const sections: ExtractedSection[] = [];
    const scannedPages: number[] = [];
    let totalChars = 0;

    pages.forEach((pageText, index) => {
      const pageNumber = index + 1;
      const trimmed = pageText.trim();
      totalChars += trimmed.length;
      if (trimmed.length < MIN_PAGE_TEXT_LENGTH) {
        scannedPages.push(pageNumber);
        return;
      }
      sections.push({
        id: `section:${index}`,
        page: pageNumber,
        content: trimmed,
      });
    });

    assertWithinCharLimit(totalChars, limits.maxExtractedChars, "Extracted text");

    if (scannedPages.length > 0) {
      if (options.ocr && options.ocrProvider) {
        const ocrProvider = options.ocrProvider;
        for (const pageNumber of scannedPages) {
          let imageBuffer: ArrayBuffer;
          try {
            imageBuffer = await renderPageAsImage(proxy, pageNumber, { scale: 2 });
          } catch (error) {
            warnings.push(
              warn(
                "unsupported-feature",
                `Could not render page ${pageNumber} as an image for OCR. This requires the ` +
                  `optional "@napi-rs/canvas" dependency to be installed alongside @ulcs/ingest. ` +
                  `(${error instanceof Error ? error.message : String(error)})`,
                { page: pageNumber },
              ),
            );
            continue;
          }

          let recognizedText: string;
          try {
            recognizedText = await ocrProvider.recognize(new Uint8Array(imageBuffer), {
              language: options.ocrLanguage,
            });
          } catch (error) {
            warnings.push(
              warn(
                "ocr-unavailable",
                `OCR provider "${ocrProvider.id}" failed on page ${pageNumber}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
                { page: pageNumber },
              ),
            );
            continue;
          }

          const trimmedOcrText = recognizedText.trim();
          if (trimmedOcrText.length === 0) {
            warnings.push(
              warn("ocr-unavailable", `OCR produced no text for page ${pageNumber}.`, {
                page: pageNumber,
              }),
            );
            continue;
          }

          totalChars += trimmedOcrText.length;
          sections.push({
            id: `section:ocr-${pageNumber}`,
            page: pageNumber,
            content: trimmedOcrText,
            metadata: { ocr: true, ocrProviderId: ocrProvider.id },
          });
        }
        sections.sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
        assertWithinCharLimit(totalChars, limits.maxExtractedChars, "Extracted text");
      } else if (options.ocr && !options.ocrProvider) {
        throw new CapabilityUnavailableError(
          `--ocr was requested but no OCR provider is configured. Pages [${scannedPages.join(", ")}] appear to be image-only/scanned and cannot be extracted without one.`,
          { pages: scannedPages },
        );
      } else {
        warnings.push(
          warn(
            "ocr-unavailable",
            `Pages [${scannedPages.join(", ")}] appear to be image-only/scanned and produced no extractable text. Configure an OCR provider and pass --ocr to attempt recognition.`,
            { pages: scannedPages },
          ),
        );
      }
    }

    let metadata: Record<string, unknown> = { totalPages };
    let title: string | undefined;
    try {
      const meta = await getMeta(proxy);
      metadata = { ...metadata, info: meta.info, documentMetadata: meta.metadata };
      const infoTitle = (meta.info as Record<string, unknown> | undefined)?.["Title"];
      if (typeof infoTitle === "string" && infoTitle.trim()) title = infoTitle.trim();
    } catch {
      warnings.push(warn("partial-extraction", "Could not read PDF document metadata."));
    }

    if (sections.length === 0) {
      warnings.push(warn("empty-content", "No extractable text found in any page of this PDF."));
    }

    return buildExtractedDocument({
      input,
      mediaType: "application/pdf",
      data: input.data,
      title,
      sections,
      metadata,
      warnings,
      extractedAt: new Date().toISOString(),
    });
  },
};
