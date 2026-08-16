/**
 * Public types for @ulcs/ingest. The extraction layer produces normalized,
 * provider-agnostic content only — it never builds provider-specific
 * prompts, and it never treats extracted text as an authoritative
 * instruction (see mapper.ts and specification/v1/security.md).
 */
import type {
  ContextEnvelope,
  InstructionAuthority,
  Resource,
  SensitivityLevel,
  TrustLevel,
} from "@ulcs/core";

export type InputSource =
  | { kind: "file"; path: string }
  | { kind: "directory"; path: string; recursive?: boolean }
  | { kind: "url"; url: string }
  | { kind: "buffer"; data: Uint8Array; filename?: string; mediaType?: string }
  | { kind: "text"; content: string; name?: string; mediaType?: string };

/** An `InputSource` resolved to bytes (or a directory listing), with detection metadata attached. */
export interface ResolvedInput {
  /** The original source description. */
  source: InputSource;
  /** Raw bytes, when the source is a single resolvable document (absent for `kind: "directory"`). */
  data?: Uint8Array;
  /** Best-effort filename, when known. */
  filename?: string;
  /** Detected or supplied media type (MIME). */
  mediaType?: string;
  /** Origin URI: file path, URL, or a synthetic identifier for buffers/text. */
  sourceUri?: string;
}

export type IngestionWarningCode =
  | "empty-content"
  | "ocr-unavailable"
  | "unsupported-feature"
  | "truncated"
  | "malformed-content"
  | "partial-extraction"
  | "skipped-entry";

export interface IngestionWarning {
  code: IngestionWarningCode;
  message: string;
  context?: Record<string, unknown>;
}

export interface ExtractedSection {
  id: string;
  content: string;
  title?: string;
  page?: number;
  slide?: number;
  sheet?: string;
  rowStart?: number;
  rowEnd?: number;
  section?: string;
  language?: string;
  metadata?: Record<string, unknown>;
}

export interface ExtractedDocument {
  id: string;
  title?: string;
  mediaType: string;
  sourceUri?: string;
  filename?: string;
  /** SHA-256 hex digest of the raw input bytes. */
  contentHash: string;
  byteLength: number;
  extractedAt: string;
  sections: ExtractedSection[];
  metadata: Record<string, unknown>;
  warnings: IngestionWarning[];
}

export interface ExtractionOptions {
  /** Explicit extractor id override (bypasses detection). */
  type?: string;
  /** Enable OCR for scanned/image-only content, if a provider is registered. */
  ocr?: boolean;
  ocrProvider?: OcrProvider;
  /** Language hint passed through to `OcrProvider.recognize`. */
  ocrLanguage?: string;
  /** CSV/TSV delimiter override. */
  delimiter?: string;
  /**
   * Allow a small, bounded amount of malformed UTF-8 through as
   * replacement characters instead of rejecting the input as
   * not-actually-text. Off by default — see `decodeTextSafely`.
   */
  tolerantTextDecoding?: boolean;
  /** Maximum fraction (0-1) of invalid-sequence bytes allowed when `tolerantTextDecoding` is set. Default 0.05. */
  maxInvalidSequenceRatio?: number;
  /** Resource limits applied during extraction. */
  limits?: Partial<ResourceLimits>;
  /** Abort signal for cooperative cancellation / timeouts. */
  signal?: AbortSignal;
}

/** Optional OCR capability. Extractors call this only when `--ocr` is set AND a provider is configured. */
export interface OcrProvider {
  readonly id: string;
  recognize(image: Uint8Array, options?: { language?: string }): Promise<string>;
}

export interface ContentExtractor {
  readonly id: string;
  readonly name: string;
  readonly extensions: readonly string[];
  readonly mediaTypes: readonly string[];

  supports(input: ResolvedInput): boolean | Promise<boolean>;
  extract(input: ResolvedInput, options: ExtractionOptions): Promise<ExtractedDocument>;
}

export interface ResourceLimits {
  maxInputBytes: number;
  maxExtractedChars: number;
  maxArchiveEntries: number;
  maxArchiveUncompressedBytes: number;
  maxCompressionRatio: number;
  maxDirectoryFileCount: number;
  maxDirectoryTotalBytes: number;
  maxUrlResponseBytes: number;
  maxRedirects: number;
  extractionTimeoutMs: number;
  maxSections: number;
  maxRows: number;
  maxSheets: number;
  maxSlides: number;
  maxPages: number;
}

export type ChunkStrategy =
  | "none"
  | "characters"
  | "paragraphs"
  | "sentences"
  | "pages"
  | "slides"
  | "rows"
  | "sections"
  | "auto";

export interface ChunkingOptions {
  strategy: ChunkStrategy;
  maxChars: number;
  maxTokens?: number;
  overlap: number;
  minChunkSize: number;
  preserveStructuralBoundary: boolean;
  deduplicate: boolean;
  removeEmpty: boolean;
  tokenizer?: (text: string) => number;
}

/** A single structural locator, used both as a `Chunk`'s primary location and as an entry in `sourceLocators` when a chunk spans more than one. */
export interface ChunkLocator {
  page?: number;
  slide?: number;
  sheet?: string;
  rowStart?: number;
  rowEnd?: number;
  section?: string;
}

export interface Chunk {
  id: string;
  content: string;
  index: number;
  totalChunks: number;
  sectionId?: string;
  title?: string;
  page?: number;
  slide?: number;
  sheet?: string;
  rowStart?: number;
  rowEnd?: number;
  section?: string;
  tokenEstimate?: number;
  metadata?: Record<string, unknown>;
  /**
   * Every structural locator folded into this chunk, in source order.
   * Populated only when `preserveStructuralBoundary: false` allowed
   * adjacent structural units (pages/slides/sheets/sections) to be packed
   * together — a chunk built under the default (`true`) always maps 1:1
   * onto its own `page`/`slide`/etc. fields and leaves this undefined, so
   * existing consumers reading only the top-level locator fields are
   * unaffected.
   */
  sourceLocators?: ChunkLocator[];
}

export interface MappingOptions {
  trust?: TrustLevel;
  sensitivity?: SensitivityLevel;
  tags?: string[];
  metadata?: Record<string, unknown>;
  objective?: string;
  instruction?: string;
  includeDefaultInstruction?: boolean;
  maxContextTokens?: number;
  reservedOutputTokens?: number;
  /**
   * Authority for the default data-usage instruction. Defaults to `"user"`
   * — the lowest authority that still lets a host prompt reasonably defer
   * to it. Selecting `"application"`, `"developer"`, or `"system"` is an
   * explicit, host-application-only escalation: the ingestion CLI never
   * sets this, and it must never be derived from ingested content.
   */
  defaultInstructionAuthority?: InstructionAuthority;
}

export interface IngestOptions extends ExtractionOptions, Partial<ChunkingOptions> {
  chunkStrategy?: ChunkStrategy;
  mapping?: MappingOptions;
  onError?: "stop" | "continue";
  include?: string[];
  exclude?: string[];
  /** Host-application opt-in to allow private-network URL targets. Disabled by default. */
  allowPrivateNetworkUrls?: boolean;
  /** Host-application opt-in to ingest a non-2xx HTTP response body instead of rejecting it. Disabled by default. */
  acceptErrorResponses?: boolean;
}

export interface DirectoryFileResult {
  path: string;
  status: "processed" | "skipped" | "failed";
  reason?: string;
  document?: ExtractedDocument;
}

export interface IngestionReport {
  input: string;
  detectedType?: string;
  extractorId?: string;
  sectionsExtracted: number;
  chunksCreated: number;
  estimatedTokens: number;
  warnings: IngestionWarning[];
  directorySummary?: {
    processed: number;
    skipped: number;
    failed: number;
    files: DirectoryFileResult[];
  };
}

export interface IngestResult {
  envelope: ContextEnvelope;
  documents: ExtractedDocument[];
  chunks: Chunk[];
  resources: Resource[];
  report: IngestionReport;
}

export const DEFAULT_LIMITS: ResourceLimits = {
  maxInputBytes: 100 * 1024 * 1024,
  maxExtractedChars: 20 * 1024 * 1024,
  maxArchiveEntries: 10_000,
  maxArchiveUncompressedBytes: 500 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxDirectoryFileCount: 50_000,
  maxDirectoryTotalBytes: 2 * 1024 * 1024 * 1024,
  maxUrlResponseBytes: 25 * 1024 * 1024,
  maxRedirects: 5,
  extractionTimeoutMs: 60_000,
  maxSections: 50_000,
  maxRows: 500_000,
  maxSheets: 200,
  maxSlides: 2_000,
  maxPages: 5_000,
};

export const DEFAULT_CHUNKING: ChunkingOptions = {
  strategy: "auto",
  maxChars: 2_000,
  overlap: 200,
  minChunkSize: 50,
  preserveStructuralBoundary: true,
  deduplicate: true,
  removeEmpty: true,
};
