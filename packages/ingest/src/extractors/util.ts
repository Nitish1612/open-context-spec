import { createHash } from "node:crypto";
import { ExtractionError } from "../errors.js";
import type {
  ExtractedDocument,
  ExtractedSection,
  IngestionWarning,
  ResolvedInput,
} from "../types.js";

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function makeDocumentId(contentHash: string): string {
  return `doc:${contentHash.slice(0, 16)}`;
}

export interface BuildDocumentInput {
  input: ResolvedInput;
  mediaType: string;
  data: Uint8Array;
  title?: string;
  sections: ExtractedSection[];
  metadata?: Record<string, unknown>;
  warnings?: IngestionWarning[];
  extractedAt: string;
}

export function buildExtractedDocument(build: BuildDocumentInput): ExtractedDocument {
  const contentHash = sha256Hex(build.data);
  const id = makeDocumentId(contentHash);
  return {
    id,
    title: build.title,
    mediaType: build.mediaType,
    sourceUri: build.input.sourceUri,
    filename: build.input.filename,
    contentHash,
    byteLength: build.data.byteLength,
    extractedAt: build.extractedAt,
    sections: build.sections,
    metadata: build.metadata ?? {},
    warnings: build.warnings ?? [],
  };
}

export type TextEncodingKind = "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be";

export interface DecodeTextResult {
  text: string;
  hadInvalidSequences: boolean;
  encoding: TextEncodingKind;
}

const DEFAULT_MAX_INVALID_SEQUENCE_RATIO = 0.05;
/** Any NUL byte at all is a strong binary signal for text formats — ordinary Unicode text never legitimately contains one. */
const NUL_BYTE_THRESHOLD = 0;

/**
 * Decides whether `data` is text at all, and if so, which encoding —
 * rather than the previous policy of silently lossy-decoding literally
 * anything as UTF-8 with a warning (which made "binary guard" claims in
 * the documentation inaccurate: a warning is not a guard). Policy:
 *
 * - A UTF-16 BOM (LE `FF FE` / BE `FE FF`) is honored explicitly — this is
 *   the one case where a *different* encoding is used, not a rejection.
 * - A UTF-8 BOM is recognized and stripped.
 * - Any NUL byte is checked for FIRST, before even attempting a UTF-8
 *   decode — a NUL byte is itself a legal single-byte UTF-8 code point, so
 *   binary content such as raw UTF-16-without-BOM ASCII text (which
 *   alternates an ASCII byte with a NUL byte) can otherwise strict-decode
 *   as "perfectly valid" UTF-8 while still being obviously not ordinary
 *   text. This is a hard rejection (`ExtractionError`) regardless of the
 *   `tolerant` option — NUL bytes are not the kind of bounded corruption
 *   tolerant mode is meant to allow through.
 * - Otherwise, content that decodes as strictly valid UTF-8 (after any BOM)
 *   is accepted with no warning.
 * - Otherwise: any invalid UTF-8 sequence makes this "strongly appears
 *   binary". By default that's a hard rejection (`ExtractionError`) — not
 *   silently replaced-and-warned. Only when the caller explicitly opts into
 *   `tolerant: true` is a *bounded* amount of invalid-sequence replacement
 *   allowed through (still capped by `maxInvalidSequenceRatio`, default 5%
 *   of the decoded length) — even tolerant mode rejects content that's
 *   mostly garbage.
 */
export function decodeTextSafely(
  data: Uint8Array,
  options: { tolerant?: boolean; maxInvalidSequenceRatio?: number } = {},
): DecodeTextResult {
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
    return {
      text: new TextDecoder("utf-16le").decode(data.subarray(2)),
      hadInvalidSequences: false,
      encoding: "utf-16le",
    };
  }
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
    return {
      text: new TextDecoder("utf-16be").decode(data.subarray(2)),
      hadInvalidSequences: false,
      encoding: "utf-16be",
    };
  }

  const hasUtf8Bom = data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf;
  const payload = hasUtf8Bom ? data.subarray(3) : data;

  // NUL bytes are checked BEFORE attempting a strict decode, not after: a NUL
  // byte is itself a legal single-byte UTF-8 code point, so payloads that are
  // actually binary — e.g. raw UTF-16-without-BOM ASCII text, which
  // alternates an ASCII byte with a NUL byte — can strict-decode as
  // "perfectly valid" UTF-8 while still being obviously not the ordinary
  // text this decoder is meant to accept. Checking first closes that gap.
  let nulCount = 0;
  for (let i = 0; i < payload.length; i++) if (payload[i] === 0) nulCount++;
  if (nulCount > NUL_BYTE_THRESHOLD) {
    throw new ExtractionError(
      `Input contains ${nulCount} NUL byte(s), which does not occur in ordinary text; this looks like binary data routed to a text extractor.`,
      undefined,
      { nulCount, byteLength: payload.length },
    );
  }

  const strict = new TextDecoder("utf-8", { fatal: true });
  try {
    return {
      text: strict.decode(payload),
      hadInvalidSequences: false,
      encoding: hasUtf8Bom ? "utf-8-bom" : "utf-8",
    };
  } catch {
    // Fall through to the binary-vs-tolerant-text decision below.
  }

  const lenient = new TextDecoder("utf-8", { fatal: false });
  const lenientText = lenient.decode(payload);
  const replacementCount = (lenientText.match(/�/g) ?? []).length;
  const invalidRatio = payload.length > 0 ? replacementCount / payload.length : 0;

  const tolerant = options.tolerant ?? false;
  const maxRatio = options.maxInvalidSequenceRatio ?? DEFAULT_MAX_INVALID_SEQUENCE_RATIO;

  if (!tolerant && replacementCount > 0) {
    throw new ExtractionError(
      `Input contains invalid UTF-8 byte sequences (${replacementCount} of ${payload.length} bytes, ${(invalidRatio * 100).toFixed(1)}%) and does not appear to be text. Pass a tolerant decoding option to allow a small amount of malformed UTF-8 through anyway.`,
      undefined,
      { replacementCount, byteLength: payload.length, invalidRatio },
    );
  }
  if (tolerant && invalidRatio > maxRatio) {
    throw new ExtractionError(
      `Input is too corrupted to treat as text even in tolerant mode (${(invalidRatio * 100).toFixed(1)}% invalid sequences, exceeding the ${(maxRatio * 100).toFixed(1)}% limit).`,
      undefined,
      { replacementCount, byteLength: payload.length, invalidRatio, maxRatio },
    );
  }

  return {
    text: lenientText,
    hadInvalidSequences: replacementCount > 0,
    encoding: hasUtf8Bom ? "utf-8-bom" : "utf-8",
  };
}

export function warn(
  code: IngestionWarning["code"],
  message: string,
  context?: Record<string, unknown>,
): IngestionWarning {
  return { code, message, context };
}
