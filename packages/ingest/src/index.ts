export * from "./types.js";
export * from "./errors.js";

export {
  detectExtractor,
  getExtractor,
  listExtractors,
  registerExtractor,
  unregisterExtractor,
  createExtractorRegistry,
  getDefaultRegistry,
  listBuiltInExtractors,
  ExtractorRegistry,
} from "./registry.js";
export type { DetectExtractorOptions, DetectionResult } from "./registry.js";

export {
  mediaTypeFromExtension,
  sniffMediaType,
  isLikelyValidUtf8,
  inferFilename,
} from "./detect.js";

export {
  ingest,
  ingestFile,
  ingestDirectory,
  ingestUrl,
  ingestText,
  ingestBuffer,
  resolveInput,
  extractDocument,
} from "./ingest.js";

export { chunkDocument } from "./chunking/index.js";

export {
  mapDocumentToResources,
  mapDocumentsToContext,
  DEFAULT_UNTRUSTED_TRUST,
  DEFAULT_DATA_USAGE_INSTRUCTION,
} from "./mapper.js";

export { builtInExtractors } from "./extractors/index.js";
export {
  textExtractor,
  markdownExtractor,
  jsonExtractor,
  jsonlExtractor,
  csvExtractor,
  tsvExtractor,
  htmlExtractor,
  xmlExtractor,
  pdfExtractor,
  docxExtractor,
  pptxExtractor,
  xlsxExtractor,
} from "./extractors/index.js";

export { fetchUrlSafely, isDisallowedIp } from "./security/urls.js";
export { safeJoin, assertNoSymlinkEscape, SymlinkLoopGuard } from "./security/paths.js";
export {
  resolveLimits,
  assertSafeArchive,
  assertWithinByteLimit,
  assertWithinCharLimit,
  assertWithinCount,
  withTimeout,
} from "./security/limits.js";

/**
 * `createIngestionPipeline` returns a small, deps-scoped façade over the
 * default SDK functions, useful when a host application wants to bind a
 * custom `ExtractorRegistry` (see `createExtractorRegistry`) once and reuse
 * it across many `ingest()` calls.
 */
import { createExtractorRegistry, type ExtractorRegistry } from "./registry.js";
import {
  extractDocument as extractDocumentImpl,
  resolveInput as resolveInputImpl,
} from "./ingest.js";
import { builtInExtractors } from "./extractors/index.js";
import type { ExtractionOptions, InputSource } from "./types.js";

export interface IngestionPipeline {
  registry: ExtractorRegistry;
  extract: (
    input: Parameters<typeof extractDocumentImpl>[0],
    options?: ExtractionOptions,
  ) => ReturnType<typeof extractDocumentImpl>;
  resolve: (
    source: InputSource,
    options?: ExtractionOptions,
  ) => ReturnType<typeof resolveInputImpl>;
}

export function createIngestionPipeline(seedWithBuiltIns = true): IngestionPipeline {
  const registry = createExtractorRegistry();
  if (seedWithBuiltIns) {
    for (const extractor of builtInExtractors()) registry.register(extractor);
  }
  return {
    registry,
    extract: (input, options) => extractDocumentImpl(input, options, { registry }),
    resolve: (source, options) => resolveInputImpl(source, options),
  };
}
