import { AmbiguousFormatError, UnsupportedFormatError } from "./errors.js";
import { inferFilename, mediaTypeFromExtension, sniffMediaType } from "./detect.js";
import type { ContentExtractor, ResolvedInput } from "./types.js";

export interface DetectExtractorOptions {
  /** Explicit override — bypasses detection entirely. */
  type?: string;
}

export interface DetectionResult {
  extractor: ContentExtractor;
  detectedMediaType?: string;
  reason: string;
}

export class ExtractorRegistry {
  private readonly extractors = new Map<string, ContentExtractor>();

  register(extractor: ContentExtractor): void {
    this.extractors.set(extractor.id, extractor);
  }

  unregister(id: string): boolean {
    return this.extractors.delete(id);
  }

  get(id: string): ContentExtractor | undefined {
    return this.extractors.get(id);
  }

  list(): ContentExtractor[] {
    return [...this.extractors.values()];
  }

  /**
   * Detects the right extractor for `input`. Detection considers, in order:
   * an explicit `--type` override; magic-byte sniffing of the actual bytes;
   * and file-extension/declared-MIME hints — extension alone is never
   * trusted, it only breaks ties among extractors whose magic-byte check
   * doesn't disambiguate (e.g. plain text formats).
   */
  async detect(
    input: ResolvedInput,
    options: DetectExtractorOptions = {},
  ): Promise<DetectionResult> {
    if (options.type) {
      const extractor = this.extractors.get(options.type);
      if (!extractor) {
        throw new UnsupportedFormatError(
          `Unknown extractor type "${options.type}".`,
          this.list().map((e) => e.id),
          { requestedType: options.type },
        );
      }
      return { extractor, reason: "explicit --type override" };
    }

    const filename = inferFilename(input);
    const sniffed = input.data ? sniffMediaType(input.data) : undefined;
    const extMediaType = mediaTypeFromExtension(filename);
    const declaredMediaType = input.mediaType;

    const effectiveMediaType = sniffed ?? declaredMediaType ?? extMediaType;

    const candidates: Array<{ extractor: ContentExtractor; score: number; reason: string }> = [];
    for (const extractor of this.extractors.values()) {
      let score = 0;
      const reasons: string[] = [];
      if (effectiveMediaType && extractor.mediaTypes.includes(effectiveMediaType)) {
        score += sniffed ? 100 : declaredMediaType ? 60 : 40;
        reasons.push(
          sniffed ? "magic-bytes" : declaredMediaType ? "declared-mime" : "extension-mime",
        );
      }
      const ext = filename ? filename.slice(filename.lastIndexOf(".")).toLowerCase() : undefined;
      if (ext && extractor.extensions.includes(ext)) {
        score += 20;
        reasons.push("extension");
      }
      if (score === 0) continue;
      // `supports()` is consulted as a confirming signal on top of the
      // extension/MIME score (which already covers magic-byte-only
      // matches `supports()` alone can't see, e.g. a mismatched
      // extension) — a positive answer nudges ranking, it doesn't gate.
      if (await extractor.supports(input)) {
        score += 5;
        reasons.push("supports()");
      }
      candidates.push({ extractor, score, reason: reasons.join("+") });
    }

    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      throw new UnsupportedFormatError(
        `No extractor found for ${filename ? `"${filename}"` : "the given input"}${
          effectiveMediaType ? ` (detected media type "${effectiveMediaType}")` : ""
        }.`,
        this.list().map((e) => e.id),
        { filename, mediaType: effectiveMediaType },
      );
    }

    const [best, second] = candidates;
    if (best && second && best.score === second.score) {
      throw new AmbiguousFormatError(
        `Ambiguous format for ${filename ? `"${filename}"` : "the given input"}.`,
        candidates.filter((c) => c.score === best.score).map((c) => c.extractor.id),
        { filename, mediaType: effectiveMediaType },
      );
    }

    if (!best) {
      throw new UnsupportedFormatError(
        `No extractor found for ${filename ? `"${filename}"` : "the given input"}.`,
        this.list().map((e) => e.id),
        { filename },
      );
    }

    return {
      extractor: best.extractor,
      detectedMediaType: effectiveMediaType,
      reason: best.reason,
    };
  }
}

export function createExtractorRegistry(): ExtractorRegistry {
  return new ExtractorRegistry();
}

let defaultRegistry: ExtractorRegistry | undefined;

/** The process-wide default registry, with all built-in extractors registered. */
export function getDefaultRegistry(): ExtractorRegistry {
  if (!defaultRegistry) {
    defaultRegistry = createExtractorRegistry();
    for (const extractor of listBuiltInExtractors()) {
      defaultRegistry.register(extractor);
    }
  }
  return defaultRegistry;
}

// Populated lazily to avoid a require-cycle with extractors/index.ts, which
// imports types from this module's neighbors only (not from registry.ts).
import { builtInExtractors } from "./extractors/index.js";

export function listBuiltInExtractors(): ContentExtractor[] {
  return builtInExtractors();
}

// Convenience module-level functions delegating to the default registry,
// matching the SDK surface documented in the README.
export function registerExtractor(extractor: ContentExtractor): void {
  getDefaultRegistry().register(extractor);
}

export function unregisterExtractor(id: string): boolean {
  return getDefaultRegistry().unregister(id);
}

export function getExtractor(id: string): ContentExtractor | undefined {
  return getDefaultRegistry().get(id);
}

export function listExtractors(): ContentExtractor[] {
  return getDefaultRegistry().list();
}

export function detectExtractor(
  input: ResolvedInput,
  options?: DetectExtractorOptions,
): Promise<DetectionResult> {
  return getDefaultRegistry().detect(input, options);
}
