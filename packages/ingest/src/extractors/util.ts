import { createHash } from "node:crypto";
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

/** UTF-8 decode with a clear failure signal instead of silently emitting replacement characters for binary data. */
export function decodeUtf8Strict(data: Uint8Array): { text: string; hadInvalidSequences: boolean } {
  const strict = new TextDecoder("utf-8", { fatal: true });
  try {
    return { text: strict.decode(data), hadInvalidSequences: false };
  } catch {
    const lenient = new TextDecoder("utf-8", { fatal: false });
    return { text: lenient.decode(data), hadInvalidSequences: true };
  }
}

export function warn(
  code: IngestionWarning["code"],
  message: string,
  context?: Record<string, unknown>,
): IngestionWarning {
  return { code, message, context };
}
